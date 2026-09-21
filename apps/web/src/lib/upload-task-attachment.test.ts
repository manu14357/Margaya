import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StorageUploadError,
  uploadTaskAttachment,
} from "./upload-task-attachment";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  createUpload: vi.fn(),
  finalize: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/fetchers/task-attachment/create-task-attachment-upload", () => ({
  default: mocks.createUpload,
}));
vi.mock("@/fetchers/task-attachment/finalize-task-attachment", () => ({
  default: mocks.finalize,
}));

const attachment = {
  id: "asset-1",
  taskId: "task-1",
  filename: "spec.pdf",
  mimeType: "application/pdf",
  size: 4,
  kind: "attachment",
  url: "https://api.example/api/asset/asset-1",
  downloadUrl: "https://api.example/api/asset/asset-1?download=1",
  createdBy: null,
  createdAt: "2026-09-26T00:00:00.000Z",
};

beforeEach(() => {
  mocks.calls = [];
  mocks.createUpload.mockImplementation(async () => {
    mocks.calls.push("upload");
    return {
      key: "ws/p/task/task-1/attachments/spec.pdf",
      uploadUrl: "https://storage.example/put",
      headers: { "Content-Type": "application/pdf" },
    };
  });
  mocks.fetch.mockImplementation(async () => {
    mocks.calls.push("put");
    return { ok: true, status: 200 };
  });
  mocks.finalize.mockImplementation(async () => {
    mocks.calls.push("finalize");
    return attachment;
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("uploadTaskAttachment", () => {
  it("asks for an upload, PUTs the bytes, then finalizes, in that order", async () => {
    const file = new File(["spec"], "spec.pdf", { type: "application/pdf" });

    const result = await uploadTaskAttachment({ taskId: "task-1", file });

    expect(mocks.calls).toEqual(["upload", "put", "finalize"]);
    expect(mocks.createUpload).toHaveBeenCalledWith("task-1", {
      filename: "spec.pdf",
      contentType: "application/pdf",
      size: 4,
    });
    expect(mocks.fetch).toHaveBeenCalledWith("https://storage.example/put", {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    expect(mocks.finalize).toHaveBeenCalledWith("task-1", {
      key: "ws/p/task/task-1/attachments/spec.pdf",
      filename: "spec.pdf",
      contentType: "application/pdf",
      size: 4,
    });
    expect(result).toBe(attachment);
  });

  it("uses a generic content type when the browser detects none", async () => {
    const file = new File(["conf"], "server.conf");

    await uploadTaskAttachment({ taskId: "task-1", file });

    expect(mocks.createUpload).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ contentType: "application/octet-stream" }),
    );
  });

  it("throws when storage refuses the PUT and never finalizes", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
    const file = new File(["spec"], "spec.pdf", { type: "application/pdf" });

    await expect(
      uploadTaskAttachment({ taskId: "task-1", file }),
    ).rejects.toBeInstanceOf(StorageUploadError);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
});
