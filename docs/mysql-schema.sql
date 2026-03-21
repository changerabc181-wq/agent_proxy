CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL
);

CREATE TABLE upstream_accounts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  provider ENUM('openrouter', 'minimax', 'generic-openai') NOT NULL,
  base_url VARCHAR(255) NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  api_key_masked VARCHAR(32) NOT NULL,
  default_model VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  created_at DATETIME NOT NULL
);

CREATE TABLE model_mappings (
  id VARCHAR(36) PRIMARY KEY,
  upstream_account_id VARCHAR(36) NOT NULL,
  protocol ENUM('anthropic', 'openai') NOT NULL,
  requested_model VARCHAR(128) NOT NULL,
  target_model VARCHAR(128) NOT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (upstream_account_id) REFERENCES upstream_accounts(id)
);

CREATE TABLE api_keys (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  protocol ENUM('anthropic', 'openai') NOT NULL,
  name VARCHAR(128) NOT NULL,
  prefix VARCHAR(16) NOT NULL,
  hashed_secret VARCHAR(255) NOT NULL,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE quota_policies (
  user_id VARCHAR(36) PRIMARY KEY,
  mode ENUM('limited', 'unlimited') NOT NULL,
  monthly_token_limit BIGINT NULL,
  remaining_tokens BIGINT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE proxy_requests (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  api_key_id VARCHAR(36) NOT NULL,
  protocol ENUM('anthropic', 'openai') NOT NULL,
  requested_model VARCHAR(128) NOT NULL,
  mapped_model VARCHAR(128) NOT NULL,
  upstream_account_id VARCHAR(36) NOT NULL,
  status ENUM('success', 'upstream_error', 'quota_rejected', 'auth_rejected') NOT NULL,
  latency_ms INT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id),
  FOREIGN KEY (upstream_account_id) REFERENCES upstream_accounts(id)
);

CREATE TABLE proxy_events (
  id VARCHAR(36) PRIMARY KEY,
  request_id VARCHAR(36) NOT NULL,
  type VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  payload JSON NOT NULL,
  FOREIGN KEY (request_id) REFERENCES proxy_requests(id)
);

CREATE TABLE usage_ledger (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  request_id VARCHAR(36) NOT NULL,
  provider ENUM('openrouter', 'minimax', 'generic-openai') NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cached_tokens INT NOT NULL,
  estimated_cost_usd DECIMAL(10, 6) NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (request_id) REFERENCES proxy_requests(id)
);
