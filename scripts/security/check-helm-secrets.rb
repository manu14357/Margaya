require 'yaml'
require 'open3'

def render(*args)
  stdout, stderr, status = Open3.capture3('helm', 'template', 'security-test', 'charts/margaya', *args)
  raise stderr unless status.success?
  YAML.load_stream(stdout).compact
end

def verify(condition, message)
  raise message unless condition
end

def app_env(docs)
  deployment = docs.find { |d| d['kind'] == 'Deployment' && !d['metadata']['name'].end_with?('-postgresql') }
  deployment.fetch('spec').fetch('template').fetch('spec').fetch('containers').first.fetch('env')
end

secret = 'test-auth-secret-at-least-32-characters'
args = ['--set', "margaya.env.authSecret=#{secret}", '--set', 'margaya.env.clientUrl=https://margaya.example.com']
first = render(*args)
second = render(*args, '--is-upgrade')
[first, second].each do |docs|
  env = app_env(docs).find { |e| e['name'] == 'AUTH_SECRET' }
  verify(!env.key?('value'), 'AUTH_SECRET must not be a literal in the Deployment')
  ref = env.fetch('valueFrom').fetch('secretKeyRef')
  resource = docs.find { |d| d['kind'] == 'Secret' && d['metadata']['name'] == ref['name'] }
  verify(resource.fetch('stringData').fetch(ref['key']) == secret, 'Secret value must be preserved on install and upgrade')
  docs.select { |d| d['kind'] == 'Deployment' }.each do |deployment|
    verify(!deployment.to_s.include?(secret), 'Secret material leaked into a Deployment')
  end
end

external = render('--set', 'margaya.env.clientUrl=https://margaya.example.com', '--set', 'margaya.env.existingSecret.enabled=true', '--set', 'margaya.env.existingSecret.name=operator-secret')
ref = app_env(external).find { |e| e['name'] == 'AUTH_SECRET' }.fetch('valueFrom').fetch('secretKeyRef')
verify(ref == { 'name' => 'operator-secret', 'key' => 'auth-secret' }, 'Existing secret reference changed')
verify(external.none? { |d| d['kind'] == 'Secret' && d['metadata']['name'].end_with?('-auth') }, 'Existing secret must not be overwritten')
_, _, status = Open3.capture3('helm', 'template', 'security-test', 'charts/margaya', '--set', 'margaya.env.existingSecret.enabled=true')
verify(!status.success?, 'Missing external secret name must reject the configuration')

secured = render(*args, '--set', 'podSecurityContext.runAsNonRoot=true', '--set', 'podSecurityContext.seccompProfile.type=RuntimeDefault')
deployment = secured.find { |d| d['kind'] == 'Deployment' && !d['metadata']['name'].end_with?('-postgresql') }
context = deployment['spec']['template']['spec']['securityContext']
verify(context['runAsNonRoot'] && context.dig('seccompProfile', 'type') == 'RuntimeDefault', 'Documented pod security settings are not applied')
puts 'Helm secret, upgrade, external-secret validation and pod security checks passed'

['', '   ', 'ftp://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#fragment'].each do |url|
  _, stderr, status = Open3.capture3('helm', 'template', 'security-test', 'charts/margaya', '--set', "margaya.env.authSecret=#{secret}", '--set-string', "margaya.env.clientUrl=#{url}")
  verify(!status.success? && stderr.include?('margaya.env.clientUrl'), "Invalid clientUrl must produce an actionable error: #{url.inspect}")
end
['https://margaya.example.com', 'http://localhost:8080', 'http://[::1]:8080/', ' https://margaya.example.com/ '].each do |url|
  docs = render(*args, '--set-string', "margaya.env.clientUrl=#{url}")
  client = app_env(docs).find { |env| env['name'] == 'MARGAYA_CLIENT_URL' }
  verify(client['value'] == url.strip.sub(%r{/$}, ''), 'Public origin must be trimmed and safe for API URL derivation')
end
puts 'Helm required-origin validation and URL rendering checks passed'

# Bundled PostgreSQL credentials reach the pod as strings, and unquoted YAML
# numbers (which Helm turns into floats such as 1.2345678e+07) are rejected.
numeric = render(*args, '--set-string', 'postgresql.auth.password=12345678', '--set-string', 'postgresql.auth.username=007')
pg_env = numeric.find { |d| d['kind'] == 'Deployment' && d['metadata']['name'].end_with?('-postgresql') }
  .dig('spec', 'template', 'spec', 'containers', 0, 'env')
verify(pg_env.find { |e| e['name'] == 'POSTGRES_PASSWORD' }['value'] == '12345678', 'Numeric-looking PostgreSQL password must render as a string')
verify(pg_env.find { |e| e['name'] == 'POSTGRES_USER' }['value'] == '007', 'Numeric-looking PostgreSQL user must render as a string')
verify(app_env(numeric).find { |e| e['name'] == 'DATABASE_URL' }['value'].include?('007:12345678@'), 'DATABASE_URL must keep numeric-looking credentials verbatim')
_, stderr, status = Open3.capture3('helm', 'template', 'security-test', 'charts/margaya', *args, '--set', 'postgresql.auth.password=12345678')
verify(!status.success? && stderr.include?('postgresql.auth.password must be a string'), 'An unquoted numeric password must be rejected')

# Redis and S3 settings: plain values where harmless, Secret references for credentials.
scaled = render(*args, '--set', 'margaya.env.redis.existingSecret.name=margaya-redis', '--set', 'margaya.env.s3.endpoint=https://files.example.com', '--set', 'margaya.env.s3.bucket=uploads', '--set', 'margaya.env.s3.forcePathStyle=false', '--set', 'margaya.env.s3.existingSecret.name=margaya-s3')
env = app_env(scaled)
verify(env.find { |e| e['name'] == 'REDIS_URL' }.dig('valueFrom', 'secretKeyRef') == { 'name' => 'margaya-redis', 'key' => 'redis-url' }, 'REDIS_URL must come from the configured Secret')
verify(env.find { |e| e['name'] == 'S3_BUCKET' }['value'] == 'uploads' && env.find { |e| e['name'] == 'S3_FORCE_PATH_STYLE' }['value'] == 'false', 'S3 settings must render')
verify(env.find { |e| e['name'] == 'S3_SECRET_ACCESS_KEY' }.dig('valueFrom', 'secretKeyRef', 'key') == 'secret-access-key', 'S3 credentials must come from the configured Secret')
verify(app_env(first).none? { |e| e['name'].start_with?('S3_', 'REDIS_') }, 'Redis and S3 stay unset by default')
iam = app_env(render(*args, '--set', 'margaya.env.s3.endpoint=https://s3.us-east-1.amazonaws.com', '--set', 'margaya.env.s3.bucket=uploads'))
verify(iam.none? { |e| e['name'].start_with?('S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY') }, 'Without a Secret, S3 keys stay unset so the IAM role is used')
puts 'Helm credential typing, Redis and S3 rendering checks passed'
