import { Directory, File, Paths } from "expo-file-system";

import type { SavedVideo } from "../types/recording";

const VIDEO_DIRECTORY_NAME = "CourtVision";

class VideoStorageService {
  async saveRecordingFromUrl(downloadUrl: string, preferredFilename?: string): Promise<SavedVideo> {
    if (!downloadUrl.trim()) {
      throw new Error("A recording download URL was not provided by the Raspberry Pi backend.");
    }

    const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
    videoDirectory.create({ idempotent: true, intermediates: true });

    const filename = this.getSafeFilename(downloadUrl, preferredFilename);
    const destination = new File(videoDirectory, filename);
    const downloadedFile = await File.downloadFileAsync(downloadUrl, destination, {
      idempotent: true
    });

    if (!downloadedFile.exists) {
      throw new Error("The recording download completed, but the saved file was not found.");
    }

    return {
      path: downloadedFile.uri
    };
  }

  private getSafeFilename(downloadUrl: string, preferredFilename?: string): string {
    const candidate = preferredFilename?.trim() || this.getFilenameFromUrl(downloadUrl);
    const safeName = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");

    if (safeName.length > 0) {
      return safeName.endsWith(".mp4") ? safeName : `${safeName}.mp4`;
    }

    return `courtvision-${Date.now()}.mp4`;
  }

  private getFilenameFromUrl(downloadUrl: string): string {
    try {
      const url = new URL(downloadUrl);
      const pathSegment = url.pathname.split("/").filter(Boolean).pop();
      return pathSegment ?? "";
    } catch {
      const pathSegment = downloadUrl.split("/").filter(Boolean).pop();
      return pathSegment ?? "";
    }
  }
}

export const videoStorageService = new VideoStorageService();
export { VideoStorageService };
