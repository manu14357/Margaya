import { useMutation } from "@tanstack/react-query";
import { saveTaskExport } from "@/lib/task-export/download";

export function useDownloadTaskExport() {
  return useMutation({ mutationFn: saveTaskExport });
}

export default useDownloadTaskExport;
