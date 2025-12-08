import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ICredentialDataDecryptedObject,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { createConnection } from 'mysql2/promise';

interface InputItem {
	date: string;
	token: string;
	event: string;
	trx_id: string;
	io_id: string;
	commission_amount: number;
	amount: number;
	currency: string;
	parent_api_call: string;
}

interface ExistingRecord {
	trx_id: string;
	amount: number;
	commission_amount: number;
	created_at: Date;
}

interface ProcessedItem {
	item: InputItem;
	status: 'new' | 'duplicate' | 'updated';
	action: 'send_to_pixel' | 'skip';
	existing?: ExistingRecord;
	pixelStatus?: 'OK' | 'ERROR';
	pixelError?: string;
	pixelPayload?: string;
}

export class RyzePixelSender implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ryze Pixel Sender',
		name: 'ryzePixelSender',
		icon: 'file:ryze.svg',
		group: ['transform'],
		version: 1,
		description: 'Handles deduplication and sending affiliate events to TrafficPoint pixel service',
		defaults: {
			name: 'Ryze Pixel Sender',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'mySqlApi',
				required: true,
			},
			{
				name: 'trafficPointApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Script ID',
				name: 'scriptId',
				type: 'string',
				default: '3000',
				required: true,
				placeholder: '3000',
				description: 'Your scraper script ID for tracking and logging',
			},
			{
				displayName: 'Pixel URL',
				name: 'pixelUrl',
				type: 'string',
				default: 'https://pixel.trafficpointltd.com/scraper',
				required: true,
				description: 'TrafficPoint pixel endpoint URL',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Dry Run Mode',
						name: 'dryRun',
						type: 'boolean',
						default: false,
						description: 'Whether to test mode - checks duplicates but doesn\'t send to pixel or insert to DB',
					},
					{
						displayName: 'Skip Deduplication',
						name: 'skipDedup',
						type: 'boolean',
						default: false,
						description: 'Whether to force send all items without checking MySQL',
					},
					{
						displayName: 'MySQL Database',
						name: 'database',
						type: 'string',
						default: 'cms',
						description: 'Database name for scraper_tokens table',
					},
					{
						displayName: 'Verbose Logging',
						name: 'verbose',
						type: 'boolean',
						default: false,
						description: 'Whether to include detailed debug information in output',
					},
					{
						displayName: 'Include Request Payloads',
						name: 'includePayloads',
						type: 'boolean',
						default: false,
						description: 'Whether to include the pixel request payloads in output for debugging',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const startTime = Date.now();

		// Get parameters
		const scriptId = this.getNodeParameter('scriptId', 0) as string;
		const pixelUrl = this.getNodeParameter('pixelUrl', 0) as string;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;
		const dryRun = (options.dryRun as boolean) || false;
		const skipDedup = (options.skipDedup as boolean) || false;
		const verbose = (options.verbose as boolean) || false;
		const includePayloads = (options.includePayloads as boolean) || false;
		const database = (options.database as string) || 'cms';

		// Get credentials
		const mysqlCredentials = await this.getCredentials('mySqlApi') as ICredentialDataDecryptedObject;
		const trafficPointCredentials = await this.getCredentials('trafficPointApi') as ICredentialDataDecryptedObject;

		const cookieHeader = trafficPointCredentials.cookieHeader as string;

		const logger = this.logger;

		// Verbose logging
		if (verbose) {
			logger.info(`[Ryze Pixel Sender] Script: ${scriptId}`);
			logger.info(`[Ryze Pixel Sender] Received: ${items.length} items`);
		}

		// Validate input items
		const inputItems: InputItem[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i].json as IDataObject;
			if (!item.date || !item.token || !item.event || !item.trx_id || !item.io_id) {
				throw new NodeOperationError(
					this.getNode(),
					`Item ${i} is missing required fields. Expected: date, token, event, trx_id, io_id, commission_amount, amount, currency, parent_api_call`,
					{ itemIndex: i }
				);
			}
			inputItems.push({
				date: item.date as string,
				token: item.token as string,
				event: item.event as string,
				trx_id: item.trx_id as string,
				io_id: item.io_id as string,
				commission_amount: item.commission_amount as number,
				amount: item.amount as number,
				currency: item.currency as string,
				parent_api_call: item.parent_api_call as string,
			});
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let connection: any = null;
		const mysqlCheckStart = Date.now();
		const processedItems: ProcessedItem[] = [];

		try {
			// Step 1: Deduplication Check (unless skipDedup is enabled)
			let existingRecords: ExistingRecord[] = [];

			if (!skipDedup) {
				if (verbose) {
					logger.info('[Ryze Pixel Sender] Checking duplicates against MySQL...');
				}

				// Connect to MySQL
				connection = await createConnection({
					host: mysqlCredentials.host as string,
					port: mysqlCredentials.port as number,
					database: database,
					user: mysqlCredentials.user as string,
					password: mysqlCredentials.password as string,
				});

				// Batch query for all trx_ids
				const trxIds = inputItems.map(item => item.trx_id);
				const [rows] = await connection.execute(
					`SELECT trx_id, amount, commission_amount, created_at
					FROM scraper_tokens
					WHERE trx_id IN (${trxIds.map(() => '?').join(',')})`,
					trxIds
				);

				existingRecords = rows as ExistingRecord[];

				if (verbose) {
					logger.info(`[Ryze Pixel Sender] ✓ Found ${existingRecords.length} existing records in DB`);
				}
			}

			const mysqlCheckMs = Date.now() - mysqlCheckStart;

			// Process each item
			for (const item of inputItems) {
				const existing = existingRecords.find(row => row.trx_id === item.trx_id);

				if (!existing) {
					// NEW - No record exists
					processedItems.push({
						item,
						status: 'new',
						action: 'send_to_pixel',
					});
				} else if (
					Number(existing.amount) === Number(item.amount) &&
					Number(existing.commission_amount) === Number(item.commission_amount)
				) {
					// EXACT DUPLICATE - All 3 fields match
					processedItems.push({
						item,
						status: 'duplicate',
						action: 'skip',
						existing,
					});
				} else {
					// UPDATED - trx_id exists but amount/commission different
					processedItems.push({
						item,
						status: 'updated',
						action: 'send_to_pixel',
						existing,
					});
				}
			}

			const newItems = processedItems.filter(p => p.status === 'new');
			const duplicates = processedItems.filter(p => p.status === 'duplicate');
			const updatedItems = processedItems.filter(p => p.status === 'updated');
			const toSend = processedItems.filter(p => p.action === 'send_to_pixel');

			if (verbose) {
				logger.info('[Ryze Pixel Sender]');
				logger.info('[Ryze Pixel Sender] Deduplication Results:');
				logger.info(`[Ryze Pixel Sender]   • New items: ${newItems.length}`);
				logger.info(`[Ryze Pixel Sender]   • Exact duplicates: ${duplicates.length} (skipping)`);
				logger.info(`[Ryze Pixel Sender]   • Updated items: ${updatedItems.length} (will resend)`);

				if (updatedItems.length > 0) {
					logger.info('[Ryze Pixel Sender]');
					logger.info('[Ryze Pixel Sender] Updated Items Details:');
					updatedItems.forEach((p, idx) => {
						logger.info(`[Ryze Pixel Sender]   ${idx + 1}. ${p.item.trx_id}`);
						logger.info(`[Ryze Pixel Sender]      OLD: amount=$${p.existing!.amount}, commission=$${p.existing!.commission_amount}`);
						logger.info(`[Ryze Pixel Sender]      NEW: amount=$${p.item.amount}, commission=$${p.item.commission_amount}`);
						logger.info(`[Ryze Pixel Sender]      First seen: ${p.existing!.created_at.toISOString().split('T')[0]}`);
					});
				}
			}

			// Step 2: Send to TrafficPoint (unless dry run)
			const pixelSendStart = Date.now();
			let pixelSuccess = 0;
			let pixelFailed = 0;

			if (!dryRun && toSend.length > 0) {
				if (verbose) {
					logger.info('[Ryze Pixel Sender]');
					logger.info(`[Ryze Pixel Sender] Sending ${toSend.length} items to TrafficPoint...`);
				}

				for (const processed of toSend) {
					const item = processed.item;

					// Build TrafficPoint payload
					const timestamp = new Date().toISOString().replace('Z', '000000Z');
					const payload = JSON.stringify({
						trackInfo: {
							tokenId: '',
							track_type: 'event',
							date: item.date,
							timestamp: timestamp,
						},
						params: {
							commission_amount: item.commission_amount,
							currency: item.currency,
							amount: item.amount,
							ioId: item.io_id,
						},
						trxId: item.trx_id,
						eventName: item.event.toLowerCase(),
						source_token: `${item.token}`,
						parent_api_call: JSON.stringify({
							parent_api_call: item.parent_api_call,
							script_id: scriptId,
							fico: item.parent_api_call.includes('fico')
								? item.parent_api_call.substring(item.parent_api_call.indexOf('fico:') + 5)
								: null,
						}),
					});

					// Store payload for debugging if requested
					if (includePayloads) {
						processed.pixelPayload = payload;
					}

					try {
						// Send to TrafficPoint
						const response = await this.helpers.httpRequest({
							method: 'POST',
							url: pixelUrl,
							headers: {
								'Cookie': cookieHeader,
								'Content-Type': 'application/x-www-form-urlencoded',
							},
							body: `data=${encodeURIComponent(payload)}`,
						});

						const result = typeof response === 'string' ? JSON.parse(response) : response;

						if (result.status === 'OK') {
							processed.pixelStatus = 'OK';
							pixelSuccess++;
						} else {
							processed.pixelStatus = 'ERROR';
							processed.pixelError = result.error || 'Unknown error';
							pixelFailed++;
						}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} catch (error: any) {
						processed.pixelStatus = 'ERROR';
						processed.pixelError = error.message || 'Request failed';
						pixelFailed++;
					}
				}

				if (verbose) {
					logger.info(`[Ryze Pixel Sender] ✓ TrafficPoint Success: ${pixelSuccess}/${toSend.length}`);
					if (pixelFailed > 0) {
						logger.info(`[Ryze Pixel Sender] ✗ TrafficPoint Failed: ${pixelFailed}/${toSend.length}`);
						logger.info('[Ryze Pixel Sender]');
						logger.info('[Ryze Pixel Sender] Failed Items:');
						toSend.filter(p => p.pixelStatus === 'ERROR').forEach(p => {
							logger.info(`[Ryze Pixel Sender]   • ${p.item.trx_id}: ${p.pixelError}${p.status === 'updated' ? ' (was update)' : ''}`);
						});
					}
				}
			}

			const pixelSendMs = Date.now() - pixelSendStart;

			// Step 3: Database Insert/Update (unless dry run)
			const dbWriteStart = Date.now();
			let dbInserted = 0;
			let dbUpdated = 0;

			if (!dryRun && connection && toSend.length > 0) {
				const successfulSends = toSend.filter(p => p.pixelStatus === 'OK');

				if (successfulSends.length > 0) {
					// Separate new and updated items
					const newToInsert = successfulSends.filter(p => p.status === 'new');
					const existingToUpdate = successfulSends.filter(p => p.status === 'updated');

					// Batch insert new records
					if (newToInsert.length > 0) {
						const values = newToInsert.map(p => [
							p.item.trx_id,
							p.item.amount,
							p.item.commission_amount,
							'scraper',
						]);

						await connection.execute(
							`INSERT INTO scraper_tokens (trx_id, amount, commission_amount, stream, created_at)
							VALUES ${values.map(() => '(?, ?, ?, ?, NOW())').join(', ')}`,
							values.flat()
						);

						dbInserted = newToInsert.length;
					}

					// Batch update existing records
					if (existingToUpdate.length > 0) {
						for (const p of existingToUpdate) {
							await connection.execute(
								`UPDATE scraper_tokens
								SET amount = ?, commission_amount = ?, created_at = NOW()
								WHERE trx_id = ?`,
								[p.item.amount, p.item.commission_amount, p.item.trx_id]
							);
							dbUpdated++;
						}
					}

					if (verbose) {
						logger.info('[Ryze Pixel Sender]');
						logger.info('[Ryze Pixel Sender] Database Updates:');
						logger.info(`[Ryze Pixel Sender]   • Inserted: ${dbInserted} new records`);
						logger.info(`[Ryze Pixel Sender]   • Updated: ${dbUpdated} existing records`);
					}
				}
			}

			const dbWriteMs = Date.now() - dbWriteStart;
			const duration = Date.now() - startTime;

			if (verbose) {
				logger.info('[Ryze Pixel Sender]');
				logger.info(`[Ryze Pixel Sender] ✓ Completed in ${(duration / 1000).toFixed(1)}s`);
			}

			// Build output
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const output: any = {
				execution: {
					mode: 'regular',
					dry_run: dryRun,
					script_id: scriptId,
					timestamp: new Date().toISOString(),
					duration_ms: duration,
				},
				summary: {
					total_input: items.length,
					new_items: newItems.length,
					exact_duplicates: duplicates.length,
					updated_items: updatedItems.length,
				},
				details: {
					exact_duplicates: duplicates.map(p => ({
						trx_id: p.item.trx_id,
						amount: p.item.amount,
						commission_amount: p.item.commission_amount,
						first_seen: p.existing?.created_at.toISOString(),
						action: 'skipped',
					})),
					updated_items: updatedItems.map(p => ({
						trx_id: p.item.trx_id,
						action: 'updated_and_sent',
						changes: {
							old_amount: p.existing!.amount,
							new_amount: p.item.amount,
							old_commission: p.existing!.commission_amount,
							new_commission: p.item.commission_amount,
							first_seen: p.existing!.created_at.toISOString(),
						},
						pixel_status: p.pixelStatus || 'PENDING',
					})),
					failed_sends: toSend.filter(p => p.pixelStatus === 'ERROR').map(p => ({
						trx_id: p.item.trx_id,
						io_id: p.item.io_id,
						error: p.pixelError,
						amount: p.item.amount,
						commission_amount: p.item.commission_amount,
						was_update: p.status === 'updated',
						changes: p.status === 'updated' ? {
							old_amount: p.existing!.amount,
							new_amount: p.item.amount,
							old_commission: p.existing!.commission_amount,
							new_commission: p.item.commission_amount,
						} : undefined,
					})),
					new_items_sample: newItems.slice(0, 5).map(p => ({
						trx_id: p.item.trx_id,
						amount: p.item.amount,
						commission_amount: p.item.commission_amount,
						event: p.item.event,
						pixel_status: p.pixelStatus || 'PENDING',
					})),
				},
				metrics: {
					mysql_check_ms: mysqlCheckMs,
					pixel_send_ms: pixelSendMs,
					db_write_ms: dbWriteMs,
				},
			};

			// Add payloads if requested
			if (includePayloads && toSend.length > 0) {
				output.details.pixel_payloads = toSend.map(p => ({
					trx_id: p.item.trx_id,
					status: p.status,
					pixel_status: p.pixelStatus || 'NOT_SENT',
					payload: p.pixelPayload ? JSON.parse(p.pixelPayload) : null,
				}));
			}

			// Add summary fields based on mode
			if (dryRun) {
				output.summary.would_send_to_pixel = toSend.length;
				output.summary.status = 'DRY_RUN_SKIPPED';
			} else {
				output.summary.sent_to_pixel = toSend.length;
				output.summary.pixel_success = pixelSuccess;
				output.summary.pixel_failed = pixelFailed;
				output.summary.db_inserted = dbInserted;
				output.summary.db_updated = dbUpdated;
			}

			return [[{ json: output }]];

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} catch (error: any) {
			if (verbose) {
				logger.error(`[Ryze Pixel Sender] ✗ Error: ${error.message}`);
			}

			const output = {
				execution: {
					mode: 'regular',
					dry_run: dryRun,
					script_id: scriptId,
					timestamp: new Date().toISOString(),
					duration_ms: Date.now() - startTime,
					success: false,
				},
				error: {
					code: error.code || 'UNKNOWN_ERROR',
					message: error.message,
					details: error.sqlMessage || error.stack,
					stage: 'execution',
				},
				summary: {
					total_input: items.length,
					processed: 0,
				},
			};

			throw new NodeOperationError(this.getNode(), JSON.stringify(output, null, 2));
		} finally {
			// Close MySQL connection
			if (connection) {
				await connection.end();
			}
		}
	}
}
