import { taskSchema } from "../schema";

describe("project task document schema", () => {
  it("preserves stored text used by the preview and download modal", () => {
    const parsed = taskSchema.parse({
      id: "document-id",
      document_name: "Research Pack",
      document_file_url: "",
      document_file_mimeType: "text/plain",
      content_text: "Visible research content",
    });

    expect(parsed.content_text).toBe("Visible research content");
  });
});
