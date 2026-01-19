{{- define "stronghold.name" -}}
stronghold
{{- end }}

{{- define "stronghold.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "stronghold.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}
