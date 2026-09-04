export function isCloud(): boolean {
  return process.env.MARGAYA_CLOUD === "true";
}
