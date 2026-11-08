const mongoose = require("mongoose");
module.exports = mongoose.model(
  "User",
  new mongoose.Schema(
    {
      name: { type: String, required: true, maxlength: 80 },
      email: { type: String, unique: true, required: true },
      favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
      directoryFavorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "DirectoryEntry" }],
      suspended: { type: Boolean, default: false },
      suspensionReason: String,
      suspendedAt: Date,
      identityStatus: {
        type: String,
        enum: ["unreviewed", "reviewed"],
        default: "unreviewed",
      },
      identityNotes: String,
      passwordHash: { type: String, required: true },
      emailVerifiedAt: Date,
      sessionVersion: {type:Number,default:0},
      mfa: {
        enabled: {type:Boolean,default:false},
        secret: {type:String,select:false},
        lastCounter: {type:Number,default:-1,select:false},
        recoveryHashes: {type:[String],select:false,default:[]},
      },
      role: { type: String, enum: ["user", "owner", "admin"], default: "user" },
    },
    { timestamps: true },
  ),
);
