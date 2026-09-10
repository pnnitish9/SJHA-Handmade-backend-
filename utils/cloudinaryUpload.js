import streamifier from "streamifier";
import cloudinary from "../config/cloudinary.js";

// Uploads a single in-memory file buffer to Cloudinary and resolves with
// the result object ({ secure_url, public_id, ... }).
export const uploadBufferToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// Uploads several files in parallel; returns [{ url, publicId }, ...]
export const uploadManyToCloudinary = async (files, folder) => {
  const uploads = files.map(async (file) => {
    const result = await uploadBufferToCloudinary(file.buffer, folder);
    return { url: result.secure_url, publicId: result.public_id };
  });
  return Promise.all(uploads);
};

export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    // Non-fatal — log and continue rather than blocking the DB operation
    console.error(`Failed to delete Cloudinary asset ${publicId}: ${error.message}`);
  }
};
