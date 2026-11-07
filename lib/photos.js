const {problem}=require('./errors');
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const multer = require("multer");
const sharp = require("sharp");
const {createStorage}=require('./storage');
const photoTypes = [
  "Exterior",
  "Single room",
  "Double room",
  "Triple room",
  "Bathroom",
  "Dining",
  "Common area",
  "Entrance",
  "Interior",
];
const allowed = ["image/jpeg", "image/png", "image/webp"];
const uploads = (count) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: count, fields: 90, parts: 110 },
    fileFilter: (req, file, cb) =>
      cb(
        allowed.includes(file.mimetype) ||
          (file.fieldname === "authorizationFiles" &&
            file.mimetype === "application/pdf")
          ? null
          : problem(400,
              "Use JPEG, PNG or WebP photos; authorization documents may also be PDFs.",
            ),
        allowed.includes(file.mimetype) ||
          (file.fieldname === "authorizationFiles" &&
            file.mimetype === "application/pdf"),
      ),
  });
const singleUpload = uploads(1).single("photo");
const propertyUpload = uploads(15).fields([
  { name: "buildingPhoto", maxCount: 1 },
  { name: "galleryPhotos", maxCount: 11 },
  { name: "authorizationFiles", maxCount: 3 },
]);
function coverPhoto(listing) {
  const photos = (listing.images || []).filter(
    (i) => i.status === "approved" && i.type === "Exterior",
  );
  return (
    photos.find((i) => String(i._id) === String(listing.coverImageId)) ||
    photos[0] ||
    null
  );
}
function submissionError(listing) {
  if (
    !(listing.images || []).some(
      (i) => i.type === "Exterior" && i.rightsDeclared,
    )
  )
    return "Add a main building / exterior photograph and confirm publication permission before submitting.";
  if (!(listing.authorizationDocuments || []).some((d) => d.declaration))
    return "Upload a PG operation authorization document for private admin review before submitting.";
  return null;
}
async function preparePhotos(files, userId, directory) {
  const prepared = [];
  const storage=createStorage({publicRoot:directory});
  try {
    await fs.mkdir(directory, { recursive: true });
    for (const { file, type } of files) {
      if (!photoTypes.includes(type)) throw problem(400,"Choose a photo type.");
      const image = sharp(file.buffer, { limitInputPixels: 40000000 });
      const metadata = await image.metadata().catch(()=>{throw problem(400,'Only actual JPEG, PNG or WebP content is accepted.');});
      if (!["jpeg", "png", "webp"].includes(metadata.format))
        throw problem(400,"Only actual JPEG, PNG or WebP content is accepted.");
      const filename = crypto.randomBytes(24).toString("hex") + ".webp";
      const content = await image
        .rotate()
        .resize({
          width: 1800,
          height: 1400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
      await storage.put('photo',filename,content);
      prepared.push({filename,type,uploadedBy:userId,rightsDeclared:true});
      const thumbnail=filename.replace('.webp','.thumb.webp');
      await storage.put('photo',thumbnail,await sharp(content).resize({width:640,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:76}).toBuffer());
      prepared[prepared.length-1].thumbnail=thumbnail;
    }
    return prepared;
  } catch (error) {
    await discardPhotos(prepared, directory);
    throw error;
  }
}
async function discardPhotos(photos, directory) {
  await Promise.all(
    photos.flatMap((p) => [p.filename,p.thumbnail||p.filename.replace('.webp','.thumb.webp')].map(filename=>fs.unlink(path.join(directory,filename)).catch(()=>{}))),
  );
}
module.exports = {
  photoTypes,
  singleUpload,
  propertyUpload,
  coverPhoto,
  submissionError,
  preparePhotos,
  discardPhotos,
};
