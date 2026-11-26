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

{{- define "uptime.dbSecretName" -}}
{{- if .Values.database.existingSecret -}}{{ .Values.database.existingSecret }}{{- else -}}{{ include "uptime.fullname" . }}-db{{- end -}}
{{- end -}}
{{- define "uptime.dbEnabled" -}}
{{- if or .Values.database.existingSecret .Values.postgresql.enabled -}}true{{- end -}}
{{- end -}}
{{- define "uptime.pgName" -}}{{ include "uptime.fullname" . }}-postgresql{{- end -}}
{{- define "uptime.pgSelectorLabels" -}}
app.kubernetes.io/name: {{ include "uptime.name" . }}-postgresql
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
