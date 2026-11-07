const {problem}=require('./errors');
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");
const {validatePdf}=require('./pdf-validation');
const {createStorage}=require('./storage');
const {scanDocument}=require('./scanner');
const types = [
  "Trade licence",
  "Registration certificate",
  "Permission / NOC",
  "Other supporting document",
];
async function prepareAuthorization(files, body, userId, directory, scan) {
  if (!files.length) return [];
  if (body.authorizationDeclaration !== "yes")
    throw problem(400,
      "Confirm that you are authorized to submit these genuine PG operation documents.",
    );
  if (!types.includes(body.authorizationType))
    throw problem(400,"Choose the authorization document type.");
  const issuer =
    typeof body.authorizationIssuer === "string"
      ? body.authorizationIssuer.trim()
      : "";
  const reference =
    typeof body.authorizationReference === "string"
      ? body.authorizationReference.trim()
      : "";
  if (issuer.length > 160 || reference.length > 120)
    throw problem(400,"Document issuer or reference is too long.");
  const prepared = [];
  const storage=createStorage({privateRoot:directory});
  try {
    await fs.mkdir(directory, { recursive: true });
    for (const file of files) {
      let content, mime, ext;
      if (file.mimetype === "application/pdf") {
        if (file.buffer.subarray(0, 5).toString() !== "%PDF-")
          throw problem(400,
            "Upload a valid PDF document or a clear JPEG, PNG or WebP scan.",
          );
        await validatePdf(file.buffer);
        content = file.buffer;
        mime = "application/pdf";
        ext = "pdf";
      } else {
        const image = sharp(file.buffer, { limitInputPixels: 40000000 });
        const metadata = await image.metadata().catch(()=>{throw problem(400,'Upload a valid document scan.');});
        if (!["jpeg", "png", "webp"].includes(metadata.format))
          throw problem(400,"Upload a genuine JPEG, PNG or WebP document scan.");
        content = await image
          .rotate()
          .resize({
            width: 2600,
            height: 2600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 92 })
          .toBuffer();
        mime = "image/webp";
        ext = "webp";
      }
      const filename = crypto.randomBytes(24).toString("hex") + "." + ext;
      const scanResult=await scanDocument(file.buffer,{scan});
      if(!['clean','quarantined'].includes(scanResult.status))throw problem(400,'The document did not pass security scanning.');
      await storage.put('document', filename, content);
      prepared.push({
        filename,
        mimeType: mime,
        size: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        documentType: body.authorizationType,
        issuingAuthority: issuer,
        reference,
        uploadedBy: userId,
        declaration: true,
        status: "pending",
        scanStatus: scanResult.status,
        scanEngine: scanResult.engine,
        scannedAt: scanResult.scannedAt,
      });
    }
    return prepared;
  } catch (error) {
    await discardAuthorization(prepared, directory);
    throw error;
  }
}
async function discardAuthorization(documents, directory) {
  await Promise.all(
    documents.map((d) =>
      fs.unlink(path.join(directory, d.filename)).catch(() => {}),
    ),
  );
}
function resetAuthorization(listing) {
  for (const document of listing.authorizationDocuments || []) {
    document.status = "pending";
    document.reviewedBy = undefined;
    document.reviewedAt = undefined;
    document.reviewNotes = undefined;
  }
}
module.exports = {
  prepareAuthorization,
  discardAuthorization,
  resetAuthorization,
  authorizationTypes: types,
};
