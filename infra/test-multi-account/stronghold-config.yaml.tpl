version: 1
aws:
  accounts:
    - accountId: "${prod_account_id}"
      alias: "prod"
      region: "${region}"
      auth:
        kind: profile
        profileName: "${prod_profile}"
    - accountId: "${staging_account_id}"
      alias: "staging"
      region: "${region}"
      auth:
        kind: profile
        profileName: "${staging_profile}"
