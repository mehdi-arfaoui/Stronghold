import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

type UploadDropzoneProps = {
  label: string;
  helper?: string;
  accept: string[];
  maxSizeMb: number;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onValidationError?: (message: string | null) => void;
};

function formatAccept(accept: string[]) {
  return accept.map((ext) => ext.toLowerCase());
}

function isAllowedFile(file: File, accept: string[]) {
  const lowered = file.name.toLowerCase();
  return accept.some((ext) => lowered.endsWith(ext.toLowerCase()));
}

export function UploadDropzone({
  label,
  helper,
  accept,
  maxSizeMb,
  file,
  onFileChange,
  onValidationError,
}: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const acceptList = useMemo(() => formatAccept(accept), [accept]);
  const maxBytes = maxSizeMb * 1024 * 1024;

  const handleValidation = useCallback(
    (selected: File | null) => {
      if (!selected) {
        setLocalError(null);
        onValidationError?.(null);
        onFileChange(null);
        return;
      }

      if (!isAllowedFile(selected, acceptList)) {
        const message = `Format invalide. Formats acceptés: ${acceptList.join(", ")}`;
        setLocalError(message);
        onValidationError?.(message);
        return;
      }

      if (selected.size > maxBytes) {
        const message = `Fichier trop volumineux (max ${maxSizeMb} Mo).`;
        setLocalError(message);
        onValidationError?.(message);
        return;
      }

      setLocalError(null);
      onValidationError?.(null);
      onFileChange(selected);
    },
    [acceptList, maxBytes, maxSizeMb, onFileChange, onValidationError]
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    handleValidation(dropped);
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    handleValidation(selected);
  };

  return (
    <div className="upload-dropzone">
      <span className="form-label">{label}</span>
      {helper && <span className="helper muted">{helper}</span>}
      <div
        className={`dropzone ${isDragging ? "active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const input = event.currentTarget.querySelector("input[type='file']") as HTMLInputElement;
            input?.click();
          }
        }}
        aria-label={label}
      >
        <div className="dropzone-content">
          <span className="dropzone-title">
            {file ? `Fichier sélectionné : ${file.name}` : "Glissez-déposez ou cliquez pour ajouter"}
          </span>
          <span className="muted small">Formats: {acceptList.join(", ")} · {maxSizeMb} Mo max</span>
        </div>
        <input type="file" accept={acceptList.join(",")} onChange={handleFileInput} />
      </div>
      {localError && <div className="alert error">{localError}</div>}
    </div>
  );
}
