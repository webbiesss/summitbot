const roleIds = {
    guide: '827956660638318592',
    staff: '1528783752199929896',
};

const getRoleId = (key, fallback = null) => {
  return roleIds[key] ?? fallback;
};

const getRoleIds = () => ({ ...roleIds });

module.exports = {
  getRoleId,
  getRoleIds,
  roleIds,
};