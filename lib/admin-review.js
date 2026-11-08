const Listing = require('../models/listing');
const { submissionIssues } = require('./input');
const { submissionError } = require('./photos');
const { exactLocationUrl } = require('./maps');

function approvalReadiness(listing, { production = false, scannerConfigured = false } = {}) {
  const blockers = submissionIssues(listing);
  const owner = listing.ownerId;
  if (!owner || !['owner', 'admin'].includes(owner.role) || owner.suspended || listing.ownerSuspended)
    blockers.push('An active PG owner account is required.');
  else if (production && !owner.emailVerifiedAt) blockers.push('The owner must verify their account email.');
  const photoIssue = submissionError(listing);
  if (photoIssue) blockers.push(photoIssue);
  if ((listing.images || []).some(image => !image.rightsDeclared)) blockers.push('Publication permission is required for every photo.');
  const documents = listing.authorizationDocuments || [];
  const unscanned = documents.filter(document => document.scanStatus !== 'clean');
  if (unscanned.length) blockers.push(scannerConfigured
    ? 'Security scanning must pass for ' + unscanned.length + ' authorization document(s). Run the scan below, then review the documents.'
    : 'Document scanning is not configured on this server. The site operator must connect ClamAV before these documents can be opened or approved.');
  if (listing.listingStatus === 'approved' && documents.some(d => d.status !== 'accepted' || !d.reviewedBy || !d.reviewedAt))
    blockers.push('Authorization documents need a recorded human review. Ask the owner to resubmit.');
  if (!['submitted', 'approved', 'published'].includes(listing.listingStatus))
    blockers.push('The owner must submit this listing for review before it can be approved.');
  return { blockers: [...new Set(blockers)], scannerConfigured, unscanned: unscanned.length,
    canApprove: listing.listingStatus === 'submitted' && !blockers.length,
    canPublish: listing.listingStatus === 'approved' && !blockers.length };
}

function reviewRenderer({ production = false, documentScanner } = {}) {
  return async function renderReview(req, res, { status = 200, error = '', values = {} } = {}) {
    const listing = await Listing.findById(req.params.id).populate('ownerId', 'name email role suspended emailVerifiedAt');
    if (!listing) return res.sendStatus(404);
    return res.status(status).render('review', { listing, reviewError: error, decisionValues: values,
      proposedLocationUrl: exactLocationUrl(listing.coordinates),
      readiness: approvalReadiness(listing, { production, scannerConfigured: Boolean(documentScanner || process.env.CLAMD_HOST) }) });
  };
}
module.exports = { approvalReadiness, reviewRenderer };
