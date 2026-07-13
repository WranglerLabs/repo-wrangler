{{- define "repo-wrangler.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "repo-wrangler.labels" -}}
app.kubernetes.io/name: {{ include "repo-wrangler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "repo-wrangler.selectorLabels" -}}
app.kubernetes.io/name: {{ include "repo-wrangler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Name of the Secret to mount: an existing one, or the chart-managed one. */}}
{{- define "repo-wrangler.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "repo-wrangler.name" .) -}}
{{- end -}}
{{- end -}}
