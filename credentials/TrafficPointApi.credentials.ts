import type {
	ICredentialType,
	INodeProperties,
	Icon,
	ICredentialTestRequest,
} from 'n8n-workflow';

export class TrafficPointApi implements ICredentialType {
	name = 'trafficPointApi';

	displayName = 'TrafficPoint API';

	icon: Icon = 'file:../nodes/RyzePixelSender/ryze.svg';

	documentationUrl = 'https://github.com/ohadcohen11/n8n-nodes-ryze-pixel-sender';

	// Test by making a request to the pixel endpoint
	test: ICredentialTestRequest = {
		request: {
			method: 'GET' as const,
			url: '={{$credentials.pixelUrl}}',
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Cookie Header',
			name: 'cookieHeader',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'SES_TOKEN=...; VIEWER_TOKEN=...',
			description: 'Full cookie header for TrafficPoint authentication',
		},
		{
			displayName: 'Pixel URL',
			name: 'pixelUrl',
			type: 'string',
			default: 'https://pixel.trafficpointltd.com/scraper',
			description: 'TrafficPoint pixel endpoint URL',
		},
	];
}
