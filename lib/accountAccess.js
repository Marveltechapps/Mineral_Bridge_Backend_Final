/**
 * App user access flags (dashboard restrict / KYC reject).
 */

async function getUserAccessProfile(db, userId) {
  const profile = await db.collection('profiles').findOne({ userId: String(userId) });
  return {
    accountStatus: String(profile?.accountStatus || 'active').toLowerCase(),
    kycStatus: String(profile?.kycStatus || 'pending').toLowerCase(),
    kycRejectionReason: profile?.kycRejectionReason || null,
  };
}

function isAccountRestricted(access) {
  const status = String(access?.accountStatus || 'active').toLowerCase();
  if (status === 'active') return false;
  return status === 'restricted' || status === 'suspended';
}

function isKycRejected(access) {
  return access.kycStatus === 'rejected';
}

function accountRestrictedPayload(access) {
  return {
    error: 'Account restricted',
    message: 'Your account has been restricted by Mineral Bridge. Contact support for assistance.',
    code: 'account_restricted',
    accountStatus: access.accountStatus,
  };
}

function kycRejectedPayload(access) {
  return {
    error: 'KYC rejected',
    message:
      access.kycRejectionReason ||
      'Your identity verification was rejected. Contact Mineral Bridge support.',
    code: 'kyc_rejected',
    kycStatus: 'rejected',
    kycRejectionReason: access.kycRejectionReason,
  };
}

module.exports = {
  getUserAccessProfile,
  isAccountRestricted,
  isKycRejected,
  accountRestrictedPayload,
  kycRejectedPayload,
};
