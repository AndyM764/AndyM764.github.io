import { Directory, File, Paths } from "expo-file-system";

import { raspberryPiConfig } from "../config/raspberryPiConfig";
import type { SavedVideo } from "../types/recording";

const VIDEO_DIRECTORY_NAME = "CourtVision";

class VideoStorageService {
  async saveRecordingFromUrl(
    downloadUrl: string,
    preferredFilename?: string,
    expectedFileSize?: number,
    maxAttempts: number = raspberryPiConfig.downloadRetryCount
  ): Promise<SavedVideo> {
    if (!downloadUrl.trim()) {
      throw new Error("A recording download URL was not provided by the Raspberry Pi backend.");
    }

    const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
    videoDirectory.create({ idempotent: true, intermediates: true });

    const filename = this.getUniqueFilename(videoDirectory, downloadUrl, preferredFilename);
    const destination = new File(videoDirectory, filename);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const downloadedFile = await File.downloadFileAsync(downloadUrl, destination, {
          idempotent: true
        });

        if (!downloadedFile.exists) {
          throw new Error("The recording download completed, but the saved file was not found.");
        }

        const size = downloadedFile.size;
        if (!Number.isFinite(size) || size <= 0) {
          throw new Error("The recording was saved locally, but the file size is zero.");
        }

        if (
          typeof expectedFileSize === "number" &&
          Number.isFinite(expectedFileSize) &&
          expectedFileSize > 0 &&
          size !== expectedFileSize
        ) {
          throw new Error(
            `Recording download size mismatch: expected ${expectedFileSize} bytes, received ${size} bytes.`
          );
        }

        return {
          path: downloadedFile.uri,
          filename,
          size
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Recording download failed.");
        this.removePartialDownload(destination);

        if (attempt < maxAttempts) {
          await this.delay(raspberryPiConfig.downloadRetryDelayMs);
        }
      }
    }

    if (lastError?.name === "AbortError") {
      throw new Error(
        "Recording download timed out. The recording file remains on the Raspberry Pi and can be retried."
      );
    }

    if (lastError?.message.includes("Network request failed")) {
      throw new Error(
        `Recording download failed due to a network error: ${lastError.message} The recording file remains on the Raspberry Pi and can be retried.`
      );
    }

    throw (
      lastError ??
      new Error(
        "Recording download failed after all retry attempts. The recording file remains on the Raspberry Pi and can be retried."
      )
    );
  }

  private removePartialDownload(destination: File): void {
    try {
      if (destination.exists) {
        destination.delete();
      }
    } catch {
      // Best-effort cleanup before retry.
    }
  }

  private getUniqueFilename(
    videoDirectory: Directory,
    downloadUrl: string,
    preferredFilename?: string
  ): string {
    const baseName = this.getSafeFilename(downloadUrl, preferredFilename);
    let candidate = baseName;
    let counter = 1;

    while (new File(videoDirectory, candidate).exists) {
      const extensionless = baseName.replace(/\.mp4$/i, "");
      candidate = `${extensionless}-${counter}.mp4`;
      counter += 1;
    }

    return candidate;
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

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

export const videoStorageService = new VideoStorageService();
export { VideoStorageService };
