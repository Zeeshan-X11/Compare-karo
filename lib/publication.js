const Listing = require("../models/listing");
const { Types } = require("mongoose");
const POLICY_VERSION = 2;
const {localities} = require('./localities');
// Only these fields can ever be exposed as approved inventory. Private documents never enter a snapshot.
const fields = [
  "name",
  "description",
  "locality",
  "address",
  "monthlyRent",
  "securityDeposit",
  "oneTimeFee",
  "roomOptions",
  "propertyCategory",
  "sharingOptions",
  "amenities",
  "foodOptions",
  "foodIncluded",
  "houseRules",
  "contactName",
  "contactPhone",
  "contactPublic",
  "ownerAuthorized",
  "whatsappAllowed",
  "coordinates",
  "images",
  "coverImageId",
  "availabilityStatus",
  "availabilityConfirmedAt",
  "priceConfirmedAt",
  "propertyVerificationStatus",
  "verification",
  "createdAt",
  "updatedAt",
  "approvedAt",
  "publicationPolicyVersion",
];
function snapshot(listing) {
  const data = listing.toObject ? listing.toObject() : listing;
  const value = { listingStatus: "published" };
  for (const key of fields) if (data[key] !== undefined) value[key] = data[key];
  value.images = (data.images || []).filter((i) => i.status === "approved");
  if (value.verification)
    value.verification = {
      method: value.verification.method,
      performedAt: value.verification.performedAt,
    };
  return value;
}
function preservePublished(listing) {
  if (listing.listingStatus === "published" && !listing.publicSnapshot) {
    listing.publicSnapshot = snapshot(listing);
    if (!listing.approvedAuthorizationDocuments?.length)
      listing.approvedAuthorizationDocuments =
        listing.authorizationDocuments.map((d) =>
          d.toObject ? d.toObject() : d,
        );
    listing.markModified("publicSnapshot");
  }
}
function restrictSnapshot(listing){
  if(!listing.publicSnapshot)return;
  if(!listing.contactPublic)listing.publicSnapshot.contactPublic=false;
  if(!listing.whatsappAllowed)listing.publicSnapshot.whatsappAllowed=false;
  if(!listing.coordinates?.publicationAuthorized&&listing.publicSnapshot.coordinates)listing.publicSnapshot.coordinates.publicationAuthorized=false;
  listing.markModified('publicSnapshot');
}
function publish(listing) {
  const issues=require('./input').submissionIssues(listing);
  if(issues.length)throw require('./errors').problem(400,'Cannot publish: '+issues.join(', '));
  if(!(listing.authorizationDocuments||[]).length || listing.authorizationDocuments.some(d=>d.scanStatus!=='clean'||d.status!=='accepted'||!d.reviewedBy||!d.reviewedAt))throw require('./errors').problem(400,'Scanned authorization evidence and a recorded human review are required.');
  listing.publicationPolicyVersion = POLICY_VERSION;
  listing.listingStatus = "published";
  listing.publicHidden = false;
  listing.approvedAuthorizationDocuments = listing.authorizationDocuments.map(
    (d) => (d.toObject ? d.toObject() : d),
  );
  listing.publicSnapshot = snapshot(listing);
  listing.markModified("publicSnapshot");
}
function live(listing) {
  return (
    localities.includes(listing.publicSnapshot?.locality || listing.locality) &&
    !listing.publicHidden &&
    !listing.ownerSuspended &&
    (listing.publicSnapshot?.publicationPolicyVersion || listing.publicationPolicyVersion) === POLICY_VERSION &&
    (listing.publicSnapshot || listing.listingStatus === "published")
  );
}
const projection = Object.fromEntries(
  [
    "_id",
    "ownerId",
    "listingStatus",
    ...fields.filter((f) => f !== "verification"),
  ].map((f) => [f, 1]),
);
projection["verification.method"] = 1;
projection["verification.performedAt"] = 1;
function snapshotQuery(query) {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      if (key === "$or" || key === "$and")
        return [key, value.map(snapshotQuery)];
      return [
        key === "_id" || key === "ownerId" ? key : "publicSnapshot." + key,
        value,
      ];
    }),
  );
}
function pipeline(query = { listingStatus: "published" }) {
  query = { $and: [query, { locality: { $in: localities } }] };
  return [
    {
      $match: {
        publicHidden: { $ne: true },
        ownerSuspended: { $ne: true },
        $or: [
          {
            $and: [
              { "publicSnapshot.listingStatus": "published" },
              { "publicSnapshot.publicationPolicyVersion": POLICY_VERSION },
              snapshotQuery(query),
            ],
          },
          {
            $and: [{ publicSnapshot: null, listingStatus: "published", publicationPolicyVersion: POLICY_VERSION }, query],
          },
        ],
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$$ROOT", { $ifNull: ["$publicSnapshot", {}] }, {
            contactPublic: {$and: ["$contactPublic", {$ifNull: ["$publicSnapshot.contactPublic", "$contactPublic"]}]},
            whatsappAllowed: {$and: ["$whatsappAllowed", {$ifNull: ["$publicSnapshot.whatsappAllowed", "$whatsappAllowed"]}]},
            coordinates: {$mergeObjects: [{$ifNull: ["$publicSnapshot.coordinates", "$coordinates"]}, {publicationAuthorized: {$and: ["$coordinates.publicationAuthorized", {$ifNull: ["$publicSnapshot.coordinates.publicationAuthorized", "$coordinates.publicationAuthorized"]}]}}]}
          }],
        },
      },
    },
    { $match: query },
    {
      $lookup: {
        from: "users",
        localField: "ownerId",
        foreignField: "_id",
        as: "_owner",
        pipeline: [{ $project: { suspended: 1, role: 1, emailVerifiedAt: 1 } }],
      },
    },
    { $match: { '_owner.0':{$exists:true}, '_owner.role':{$in:['owner','admin']}, "_owner.suspended": { $ne: true }, ...(process.env.NODE_ENV==='production'?{'_owner.emailVerifiedAt':{$exists:true,$ne:null}}:{}) } },
    { $project: projection },
  ];
}
async function findPublic(
  query,
  sort = { createdAt: -1, _id: -1 },
  page = 1,
  size = 12,
) {
  const result = await Listing.aggregate([
    ...pipeline(query),
    { $sort: sort },
    {
      $facet: {
        listings: [{ $skip: (page - 1) * size }, { $limit: size }],
        count: [{ $count: "total" }],
      },
    },
  ]);
  return {
    listings: result[0]?.listings || [],
    total: result[0]?.count[0]?.total || 0,
  };
}
async function getPublic(id) {
  id = new Types.ObjectId(id);
  return (
    (
      await Listing.aggregate([
        ...pipeline({ _id: id, listingStatus: "published" }),
        { $limit: 1 },
      ])
    )[0] || null
  );
}
module.exports = {
  POLICY_VERSION,
  snapshot,
  preservePublished,
  restrictSnapshot,
  publish,
  live,
  pipeline,
  findPublic,
  getPublic,
  projection,
};
