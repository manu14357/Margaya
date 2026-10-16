{{/*
Expand the name of the chart.
*/}}
{{- define "margaya.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "margaya.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "margaya.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "margaya.labels" -}}
helm.sh/chart: {{ include "margaya.chart" . }}
{{ include "margaya.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "margaya.selectorLabels" -}}
app.kubernetes.io/name: {{ include "margaya.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "margaya.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "margaya.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
URL-encode credentials for URI userinfo. Sprig urlquery uses form escaping,
so spaces become +; in userinfo they must be %20 to preserve credentials.
*/}}
{{- define "margaya.urlencodeUserinfo" -}}
{{- . | urlquery | replace "+" "%20" -}}
{{- end }}

{{/*
API component common labels
*/}}
{{- define "margaya.api.labels" -}}
helm.sh/chart: {{ include "margaya.chart" . }}
{{ include "margaya.api.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API component selector labels
*/}}
{{- define "margaya.api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "margaya.name" . }}-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Web component common labels
*/}}
{{- define "margaya.web.labels" -}}
helm.sh/chart: {{ include "margaya.chart" . }}
{{ include "margaya.web.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: web
{{- end }}

{{/*
Web component selector labels
*/}}
{{- define "margaya.web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "margaya.name" . }}-web
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
"true" when uploads use the built-in local store: no S3 endpoint, the store
is enabled, and either one replica or a ReadWriteMany claim (a local disk is
per pod, so several replicas need a shared volume).
*/}}
{{- define "margaya.localStorage.active" -}}
{{- $local := .Values.margaya.env.localStorage -}}
{{- $multi := or (gt (int .Values.replicaCount) 1) .Values.autoscaling.enabled -}}
{{- $shared := and $local.persistence.enabled (eq $local.persistence.accessMode "ReadWriteMany") -}}
{{- if and $local.enabled (not .Values.margaya.env.s3.endpoint) (or (not $multi) $shared) -}}
true
{{- end -}}
{{- end }}

{{- define "margaya.localStorage.claimName" -}}
{{- .Values.margaya.env.localStorage.persistence.existingClaim | default (printf "%s-uploads" (include "margaya.fullname" .)) -}}
{{- end }}
