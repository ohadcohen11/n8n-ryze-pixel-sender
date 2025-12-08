# n8n-nodes-ryze-pixel-sender

[![NPM Version](https://img.shields.io/npm/v/n8n-nodes-ryze-pixel-sender)](https://www.npmjs.com/package/n8n-nodes-ryze-pixel-sender)

A custom n8n node that handles deduplication and sending affiliate events to TrafficPoint pixel service.

## ⚠️ Important: Self-Hosted Only

**This node requires a self-hosted n8n installation and will NOT work in n8n Cloud** due to the `mysql2` dependency. n8n Cloud does not support community nodes with external dependencies.

## Features

- **Automatic Deduplication**: Checks MySQL database to prevent duplicate event submissions
- **Batch Processing**: Efficiently processes multiple events in a single execution
- **Smart Updates**: Detects and resends events with updated amounts or commissions
- **TrafficPoint Integration**: Direct pixel tracking with proper authentication
- **Comprehensive Logging**: Detailed execution reports with metrics
- **Dry Run Mode**: Test mode for validating workflows without sending data

## Installation

### For Self-Hosted n8n:

```bash
npm install n8n-nodes-ryze-pixel-sender
```

Then restart your n8n instance.

### For n8n Docker:

Add to your Dockerfile or docker-compose.yml:

```dockerfile
RUN npm install -g n8n-nodes-ryze-pixel-sender
```

## Requirements

- Self-hosted n8n instance (v1.0.0 or higher)
- MySQL database (for deduplication tracking)
- TrafficPoint API access (cookie authentication)

## Configuration

### Credentials

1. **MySQL Account**
   - Host: Your MySQL server hostname
   - Port: MySQL port (default: 3306)
   - Database: Database name (default: cms)
   - User: MySQL username
   - Password: MySQL password

2. **TrafficPoint API**
   - Cookie Header: Full cookie string (e.g., `SES_TOKEN=...; VIEWER_TOKEN=...`)
   - Pixel URL: TrafficPoint endpoint (default: `https://pixel.trafficpointltd.com/scraper`)

### Node Parameters

- **Script ID** (required): Your scraper script ID for tracking
- **Pixel URL** (optional): Override default TrafficPoint endpoint
- **Options:**
  - **Dry Run Mode**: Test without sending to pixel or database
  - **Skip Deduplication**: Force send all items
  - **MySQL Database**: Override database name
  - **Verbose Logging**: Enable detailed debug output

## Input Schema

Each input item must contain these exact 9 fields:

```json
{
  "date": "2025-12-07T12:00:00",
  "token": "abc123",
  "event": "sale",
  "trx_id": "brand-sale-abc123",
  "io_id": "545f8472fe0af42e7bbb6903",
  "commission_amount": 100,
  "amount": 500,
  "currency": "USD",
  "parent_api_call": "Empty"
}
```

## Output Schema

The node outputs a comprehensive execution summary:

```json
{
  "execution": {
    "mode": "regular",
    "dry_run": false,
    "script_id": "3000",
    "timestamp": "2025-12-07T15:30:45.123Z",
    "duration_ms": 2341
  },
  "summary": {
    "total_input": 50,
    "new_items": 35,
    "exact_duplicates": 8,
    "updated_items": 7,
    "sent_to_pixel": 42,
    "pixel_success": 40,
    "pixel_failed": 2,
    "db_inserted": 35,
    "db_updated": 5
  },
  "details": {
    "exact_duplicates": [...],
    "updated_items": [...],
    "failed_sends": [...],
    "new_items_sample": [...]
  },
  "metrics": {
    "mysql_check_ms": 120,
    "pixel_send_ms": 2100,
    "db_write_ms": 121
  }
}
```

## Database Schema

The node requires a `scraper_tokens` table:

```sql
CREATE TABLE scraper_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trx_id VARCHAR(255) UNIQUE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  stream VARCHAR(50) DEFAULT 'scraper',
  created_at DATETIME NOT NULL,
  INDEX idx_trx_id (trx_id),
  INDEX idx_created_at (created_at)
);
```

## Deduplication Logic

The node identifies three types of items:

1. **New**: `trx_id` doesn't exist in database → Send to pixel
2. **Exact Duplicate**: `trx_id`, `amount`, and `commission_amount` all match → Skip
3. **Updated**: `trx_id` exists but `amount` or `commission_amount` changed → Resend

## Use Cases

### Standard Deduplication
Process affiliate events and automatically skip duplicates while catching updated commissions.

### Corrected Commissions
Automatically detect and resend events when partner sends commission corrections.

### Dry Run Testing
Test workflow configuration without affecting production data or database.

### Re-processing Data
Use "Skip Deduplication" mode to resend historical data after system outages.

## Workflow Example

Replace this 6-8 node deduplication block:

```
Before:
Filter → MySQL Check → Merge → Send to Pixel → Merge → IF OK → MySQL Insert → Done

After:
Ryze Pixel Sender → Done
```

## Performance

- 50 items: ~2-3 seconds
- 200 items: ~8-10 seconds
- 500 items: ~20-25 seconds

## Troubleshooting

### Items sent but not in database
- Check MySQL connection credentials
- Verify `scraper_tokens` table exists
- Check TrafficPoint response status

### Too many duplicates detected
- Verify `trx_id` uniqueness across workflows
- Check date format ends with `T12:00:00`
- Review MySQL query performance

### TrafficPoint returns errors
- Verify cookie header is current and valid
- Check payload format matches specification
- Confirm `io_id` exists in TrafficPoint system

## Support

For issues and questions:
- Email: ohad.cohen@ryzebeyond.com
- GitHub: [Report an issue](https://github.com/ohadcohen11/n8n-nodes-ryze-pixel-sender/issues)

## License

MIT

## Version History

### v0.1.0 (Initial Release)
- Basic deduplication with MySQL
- TrafficPoint pixel integration
- Dry run mode
- Comprehensive logging and metrics
