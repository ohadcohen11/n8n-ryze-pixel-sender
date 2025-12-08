import type {
	ICredentialType,
	INodeProperties,
	Icon,
	ICredentialTestRequest,
} from 'n8n-workflow';

export class MySqlApi implements ICredentialType {
	name = 'mySqlApi';

	displayName = 'MySQL Account';

	icon: Icon = 'file:../nodes/RyzePixelSender/ryze.svg';

	documentationUrl = 'https://docs.n8n.io/integrations/builtin/credentials/mysql/';

	// Basic connectivity test
	test: ICredentialTestRequest = {
		request: {
			method: 'GET' as const,
			url: '/',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'localhost',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 3306,
		},
		{
			displayName: 'Database',
			name: 'database',
			type: 'string',
			default: 'cms',
			description: 'Database name for scraper_tokens table',
		},
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];
}
