{{- define "uptime.name" -}}{{ .Chart.Name }}{{- end -}}
{{- define "uptime.fullname" -}}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{- end -}}
{{- define "uptime.labels" -}}
app.kubernetes.io/name: {{ include "uptime.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}
{{- define "uptime.selectorLabels" -}}
app.kubernetes.io/name: {{ include "uptime.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
