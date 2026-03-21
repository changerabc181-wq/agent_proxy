function must(selector, scope = document) {
  const node = scope.querySelector(selector);
  if (!node) {
    throw new Error(`Missing DOM node: ${selector}`);
  }
  return node;
}

export const dom = {
  pageTitle: must("#page-title"),
  breadcrumbCurrent: must("#breadcrumb-current"),
  systemStatus: must("#system-status"),
  systemTime: must("#system-time"),
  currentUser: must("#current-user"),
  currentRole: must("#current-role"),
  profileAvatar: must(".profile-avatar"),
  metrics: must("#metrics"),
  providerHealth: must("#provider-health"),
  recentRequests: must("#recent-requests"),
  upstreams: must("#upstreams"),
  users: must("#users"),
  requestList: must("#request-list"),
  meKeys: must("#me-keys"),
  meUsage: must("#me-usage"),
  auditDetail: must("#audit-detail"),
  auditDetailTitle: must("#audit-detail-title"),
  quotaPanelTitle: must("#quota-panel-title"),
  userActionTitle: must("#user-action-title"),
  userDetailCard: must("#user-detail-card"),
  userFormOutput: must("#user-form-output"),
  upstreamFormOutput: must("#upstream-form-output"),
  quotaFormOutput: must("#quota-form-output"),
  issueKeyOutput: must("#issue-key-output"),
  userApiKeyList: must("#user-api-key-list"),
  createUserForm: must("#create-user-form"),
  upstreamForm: must("#upstream-form"),
  quotaForm: must("#quota-form"),
  issueKeyForm: must("#issue-key-form"),
  upstreamSubmitButton: must("#upstream-submit"),
  upstreamToggleButton: must("#upstream-toggle-button"),
  upstreamResetButton: must("#upstream-reset-button"),
  toggleUserButton: must("#toggle-user-button"),
  deleteUserButton: must("#delete-user-button"),
  authModal: must("#auth-modal"),
  openAuthButton: must("#open-auth"),
  closeAuthButton: must("#close-auth"),
  logoutButton: must("#logout"),
  loginForm: must("#login-form"),
  sessionOutput: must("#session-output"),
  dashboardRefreshButton: must("#dashboard-refresh"),
  upstreamCount: must("#upstream-count"),
  activeUpstreamCount: must("#active-upstream-count"),
  userCount: must("#user-count"),
  quotaUserCount: must("#quota-user-count"),
  heroUpstreamFocus: must("#hero-upstream-focus"),
  heroUpstreamReset: must("#hero-upstream-reset"),
  upstreamAlert: must("#upstream-alert"),
  upstreamTabs: must("#upstream-tabs")
};

dom.upstreamPriorityInput = must('input[name="priority"]', dom.upstreamForm);
dom.upstreamNameInput = must('input[name="name"]', dom.upstreamForm);
dom.upstreamProviderInput = must('select[name="provider"]', dom.upstreamForm);
dom.upstreamBaseUrlInput = must('input[name="baseUrl"]', dom.upstreamForm);
dom.upstreamApiKeyInput = must('input[name="apiKey"]', dom.upstreamForm);
dom.upstreamDefaultModelInput = must('input[name="defaultModel"]', dom.upstreamForm);
dom.upstreamProtocolInput = must('select[name="protocol"]', dom.upstreamForm);
dom.upstreamMappingDefaultInput = must('input[name="mappingDefaultModel"]', dom.upstreamForm);
dom.quotaModeInput = must('select[name="mode"]', dom.quotaForm);
dom.quotaMonthlyInput = must('input[name="monthlyTokenLimit"]', dom.quotaForm);
dom.quotaRemainingInput = must('input[name="remainingTokens"]', dom.quotaForm);
dom.issueKeyNameInput = must('input[name="name"]', dom.issueKeyForm);
dom.issueKeyProtocolInput = must('select[name="protocol"]', dom.issueKeyForm);
dom.loginEmailInput = must('input[name="email"]', dom.loginForm);
dom.loginPasswordInput = must('input[name="password"]', dom.loginForm);
