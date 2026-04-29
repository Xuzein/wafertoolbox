import * as React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileDropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accepted file types (e.g., '.csv', '.json') */
  accept?: string[];
  /** Callback when files are dropped or selected */
  onFilesDrop: (files: File[]) => void;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Currently uploaded files */
  uploadedFiles?: Array<{ name: string }>;
  /** Whether clicking the drop zone opens the file picker */
  clickToSelect?: boolean;
}

const FileDropZone = React.forwardRef<HTMLDivElement, FileDropZoneProps>(
  (
    {
      className,
      accept = [".csv"],
      onFilesDrop,
      maxFiles = Infinity,
      uploadedFiles = [],
      clickToSelect = true,
      ...props
    },
    ref,
  ) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    const validateFiles = (files: FileList | File[]): File[] => {
      const fileArray = Array.from(files);
      const validFiles = fileArray.filter((file) => {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        return accept.includes(ext);
      });

      if (validFiles.length !== fileArray.length) {
        const invalidFiles = fileArray.filter((f) => !validFiles.includes(f));
        console.warn(
          `Invalid file types: ${invalidFiles.map((f) => f.name).join(", ")}`,
        );
      }

      const remainingSlots = maxFiles - uploadedFiles.length;
      return validFiles.slice(0, remainingSlots);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const files = validateFiles(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesDrop(files);
      }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        const validFiles = validateFiles(files);
        if (validFiles.length > 0) {
          onFilesDrop(validFiles);
        }
      }
      // Reset input
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    };

    const handleClick = () => {
      if (!clickToSelect) {
        return;
      }
      inputRef.current?.click();
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-input hover:border-muted-foreground/50",
          uploadedFiles.length >= maxFiles && "opacity-50 cursor-not-allowed",
          clickToSelect ? "cursor-pointer" : "cursor-default",
          className,
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={uploadedFiles.length < maxFiles && clickToSelect ? handleClick : undefined}
        {...props}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(",")}
          multiple={maxFiles > 1}
          onChange={handleFileInput}
          className="hidden"
        />
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full",
          )}
        >
          <Upload className="h-6 w-6 min-w-6 min-h-6" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {clickToSelect ? "拖拽文件到此处，或点击上传" : "拖拽文件到此处"}
          </p>
          <p className="text-xs text-muted-foreground">
            支持 {accept.join(", ")} 格式
          </p>
        </div>
      </div>
    );
  },
);
FileDropZone.displayName = "FileDropZone";

export { FileDropZone };
