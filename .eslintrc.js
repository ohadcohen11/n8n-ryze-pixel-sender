module.exports = {
	extends: ['@n8n/node-cli/eslint.config.js'],
	rules: {
		// Disable restricted imports rule to allow mysql2
		// This node is designed for SELF-HOSTED n8n only and requires direct MySQL access
		// WARNING: This node will NOT work in n8n Cloud due to mysql2 dependency
		'@n8n/community-nodes/no-restricted-imports': 'off',
	},
};
