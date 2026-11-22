import { describe, expect, it } from "vitest";
import { checkUpload, isOrgUploadPath, uploadPath, UPLOAD_MAX_BYTES } from "@/lib/sources/upload";

const org = "11111111-2222-3333-4444-555555555555";
const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("上传本地音视频", () => {
  it("只收 Supadata 能转的格式，不超过 50MB", () => {
    expect(checkUpload("录音.M4A", 1000)).toBeNull();
    expect(checkUpload("访谈.mp4", UPLOAD_MAX_BYTES)).toBeNull();
    expect(checkUpload("文档.pdf", 1000)).toMatch(/只支持/);
    expect(checkUpload("播客.mp3", UPLOAD_MAX_BYTES + 1)).toMatch(/超过 50MB/);
  });

  it("路径放在组织目录下，文件名换成随机 id", () => {
    expect(uploadPath(org, "我的 录音.M4A", id)).toBe(`${org}/${id}.m4a`);
  });

  it("服务端只认本组织目录下、按规则生成的路径", () => {
    expect(isOrgUploadPath(org, `${org}/${id}.mp3`)).toBe(true);
    expect(isOrgUploadPath(org, `99999999-2222-3333-4444-555555555555/${id}.mp3`)).toBe(false);
    expect(isOrgUploadPath(org, `${org}/../x/${id}.mp3`)).toBe(false);
    expect(isOrgUploadPath(org, `${org}/${id}.exe`)).toBe(false);
    expect(isOrgUploadPath(org, `${org}/notes.mp3`)).toBe(false);
  });
});
