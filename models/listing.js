const mongoose = require("mongoose");
const { localities } = require("../lib/localities");
const imageSchema = new mongoose.Schema({
  filename: String,
  thumbnail: String,
  type: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  uploadedAt: { type: Date, default: Date.now },
  rightsDeclared: Boolean,
  captureDate: Date,
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
});
const listingSchema = new mongoose.Schema(
  {
    title: String,
    image: String,
    price: Number,
    location: String,
    country: String,
    name: { type: String, trim: true, maxlength: 120 },
    description: { type: String, maxlength: 4000 },
    locality: { type: String, enum: localities },
    address: { type: String, maxlength: 500 },
    monthlyRent: { type: Number, min: 0, default: null },
    securityDeposit: { type: Number, min: 0, default: null },
    oneTimeFee: { type: Number, min: 0, default: null },
    roomOptions: [
      {
        sharing: {
          type: String,
          enum: ["Single", "Double", "Triple", "Four+"],
        },
        monthlyRent: { type: Number, min: 0, default: null },
        totalRooms: { type: Number, min: 0, default: null },
        availableRooms: { type: Number, min: 0, default: null },
      },
    ],
    whatsappAllowed: { type: Boolean, default: false },
    publicationPolicyVersion: Number,
    withdrawalRequest: {requestedAt: Date, reason: String, reviewedAt: Date, reviewedBy: mongoose.Schema.Types.ObjectId},
    publicSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
    publicHidden: { type: Boolean, default: false },
    ownerSuspended: { type: Boolean, default: false },
    statistics: {
      views: { type: Number, default: 0 },
      contactClicks: { type: Number, default: 0 },
    },
    verification: {
      method: {
        type: String,
        enum: ["unverified", "documents", "site-visit"],
        default: "unverified",
      },
      notes: String,
      performedAt: Date,
      recordedBy: mongoose.Schema.Types.ObjectId,
    },
    propertyCategory: { type: String, enum: ["Men", "Women", "Co-living"] },
    sharingOptions: [
      { type: String, enum: ["Single", "Double", "Triple", "Four+"] },
    ],
    amenities: [String],
    foodOptions: [String],
    foodIncluded: { type: Boolean, default: null },
    houseRules: { type: String, maxlength: 2000 },
    contactName: String,
    contactPhone: String,
    contactPublic: { type: Boolean, default: false },
    ownerAuthorized: { type: Boolean, default: false },
    sourceUrl: String,
    sourceDate: Date,
    coordinates: {
      latitude: Number,
      longitude: Number,
      verified: { type: Boolean, default: false },
      publicationAuthorized: { type: Boolean, default: false },
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    images: [imageSchema],
    coverImageId: mongoose.Schema.Types.ObjectId,
    authorizationDocuments: [
      {
        filename: String,
        mimeType: String,
        size: Number,
        sha256: String,
        scanStatus: {type: String, enum: ['clean','quarantined','infected'], default: 'quarantined'},
        scanEngine: String,
        scannedAt: Date,
        scanReason: String,
        documentType: String,
        issuingAuthority: String,
        reference: String,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        uploadedAt: { type: Date, default: Date.now },
        declaration: Boolean,
        status: {
          type: String,
          enum: ["pending", "accepted", "rejected"],
          default: "pending",
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: Date,
        reviewNotes: String,
      },
    ],
    availabilityStatus: {
      type: String,
      enum: ["unknown", "available", "unavailable"],
      default: "unknown",
    },
    availabilityConfirmedAt: Date,
    priceConfirmedAt: Date,
    ownerIdentityStatus: { type: String, default: "unverified" },
    propertyVerificationStatus: { type: String, default: "unverified" },
    photoReviewStatus: { type: String, default: "pending" },
    listingStatus: {
      type: String,
      enum: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "corrections",
        "published",
      ],
      default: "draft",
    },
    submittedAt: Date,
    approvedAt: Date,
    moderationNotes: String,
    moderationHistory: [
      {
        action: String,
        notes: String,
        actorId: mongoose.Schema.Types.ObjectId,
        at: Date,
      },
    ],
    reports: [
      {
        userId: mongoose.Schema.Types.ObjectId,
        message: String,
        propertyName: String,
        createdAt: Date,
        status: {
          type: String,
          enum: ["open", "resolved", "dismissed"],
          default: "open",
        },
        resolution: String,
        reviewedBy: mongoose.Schema.Types.ObjectId,
        reviewedAt: Date,
      },
    ],
  },
  { timestamps: true, optimisticConcurrency: true },
);
listingSchema.add({
  approvedAuthorizationDocuments: {
    type: [listingSchema.path("authorizationDocuments").schema],
    default: [],
  },
});
listingSchema.index({ listingStatus: 1, locality: 1, monthlyRent: 1 });
listingSchema.index({ ownerId: 1, updatedAt: -1 });
listingSchema.index({
  "publicSnapshot.listingStatus": 1,
  "publicSnapshot.locality": 1,
  "publicSnapshot.monthlyRent": 1,
});
listingSchema.index({ listingStatus: 1, submittedAt: -1 });
listingSchema.index({ "images.filename": 1 });
listingSchema.index({ "publicSnapshot.images.filename": 1 });
listingSchema.index({ "images.thumbnail": 1 });
listingSchema.index({ "publicSnapshot.images.thumbnail": 1 });
listingSchema.index({ 'reports.userId': 1, 'reports.createdAt': -1 });
listingSchema.index({ 'publicSnapshot.publicationPolicyVersion': 1, 'publicSnapshot.listingStatus': 1, 'publicSnapshot.locality': 1, 'publicSnapshot.monthlyRent': 1 });
module.exports = mongoose.model("Listing", listingSchema);
