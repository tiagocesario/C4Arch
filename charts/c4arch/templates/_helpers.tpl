{{- define "c4arch.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "c4arch.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "c4arch.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "c4arch.labels" -}}
app.kubernetes.io/name: {{ include "c4arch.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}