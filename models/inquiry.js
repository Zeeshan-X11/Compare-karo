const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, required: true, maxlength: 2000 },
    propertyName: String,
    preferredVisitDate: Date,
    reply: { type: String, maxlength: 2000 },
    scheduledVisitAt: Date,
    statusUpdatedAt: Date,
    history: [
      {
        status: String,
        reply: String,
        at: Date,
        actorId: mongoose.Schema.Types.ObjectId,
      },
    ],
    contactMethod: { type: String, enum: ["email"], default: "email" },
    status: {
      type: String,
      enum: ["new", "contacted", "visit_scheduled", "closed"],
      default: "new",
    },
  },
  { timestamps: true },
);
schema.index({ ownerId: 1, createdAt: -1 });
schema.index({ userId: 1, createdAt: -1 });
schema.index({ propertyId: 1, createdAt: -1 });
module.exports = mongoose.model("Inquiry", schema);
