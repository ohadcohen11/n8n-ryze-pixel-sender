# Ryze Pixel Sender - Custom n8n Node Specification

## Overview

A custom n8n node that handles deduplication and sending affiliate events to TrafficPoint pixel service. This node replaces the 6-8 node deduplication block in Ryze Beyond workflows.

---

## Node Information

**Package Name:** `n8n-nodes-ryze-pixel-sender`  
**Node Name:** `ryzePixelSender`  
**Display Name:** `Ryze Pixel Sender`  
**Category:** Transform  
**Icon:** Blue "R" with pixel/send symbol

---

## Input Schema

The node expects items with this **exact 9-field schema**:

```javascript
{
  "date": "2025-12-07T12:00:00",           // ISO format ending in T12:00:00 (REQUIRED)
  "token": "abc123",                        // Affiliate token/PID (REQUIRED)
  "event": "sale",                          // Event type: lead, sale, ftd, etc. (REQUIRED)
  "trx_id": "brand-sale-abc123",           // Unique transaction ID (REQUIRED)
  "io_id": "545f8472fe0af42e7bbb6903",     // Brand identifier (REQUIRED)
  "commission_amount": 100,                 // Commission in dollars (REQUIRED)
  "amount": 500,                            // Transaction amount (REQUIRED)
  "currency": "USD",                        // Currency code (REQUIRED)
  "parent_api_call": "Empty"                // Source reference (REQUIRED)
}
```

---

## Node Parameters

### **Required Parameters**

#### 1. Script ID
- **Type:** String
- **Required:** Yes
- **Description:** Your scraper script ID for tracking and logging
- **Example:** `"3000"`
- **Placeholder:** `"3000"`

#### 2. Pixel URL
- **Type:** String
- **Required:** Yes
- **Default:** `"https://pixel.trafficpointltd.com/scraper"`
- **Description:** TrafficPoint pixel endpoint URL
- **Note:** Can be overridden for testing/staging

### **Optional Parameters**

#### 3. Options Collection
- **Dry Run Mode** (boolean, default: false)
  - Test mode - checks duplicates but doesn't send to pixel or insert to DB
  - Shows what would be sent

- **Skip Deduplication** (boolean, default: false)
  - Force send all items without checking MySQL
  - Useful for re-sending corrected data

- **MySQL Database** (string, default: "cms")
  - Database name for scraper_tokens table

- **Verbose Logging** (boolean, default: false)
  - Include detailed debug information in output

---

## Credentials

### **MySQL Credential (Required)**
```javascript
{
  type: "mysql",
  name: "MySQL Account",
  properties: {
    host: "your-mysql-host",
    port: 3306,
    database: "cms",
    user: "your-user",
    password: "your-password"
  }
}
```

### **TrafficPoint API Credential (Required)**
```javascript
{
  type: "trafficPointApi",
  name: "TrafficPoint API",
  properties: {
    cookieHeader: "SES_TOKEN=...; VIEWER_TOKEN=...",
    pixelUrl: "https://pixel.trafficpointltd.com/scraper"
  }
}
```

---

## Processing Logic

### **Step 1: Deduplication Check**

Query MySQL to find existing records with **exact match on all 3 fields**:

```sql
SELECT 
  trx_id,
  amount,
  commission_amount,
  created_at
FROM scraper_tokens 
WHERE trx_id IN (?, ?, ?, ...)
```

**Matching Logic:**

```javascript
// For each input item:
const existing = mysqlResults.find(row => row.trx_id === item.trx_id);

if (!existing) {
  // NEW - No record exists
  status: "new"
  action: "send_to_pixel"
  
} else if (
  existing.amount === item.amount && 
  existing.commission_amount === item.commission_amount
) {
  // EXACT DUPLICATE - All 3 fields match
  status: "duplicate"
  action: "skip"
  
} else {
  // UPDATED - trx_id exists but amount/commission different
  status: "updated"
  action: "send_to_pixel"
  reason: {
    old_amount: existing.amount,
    new_amount: item.amount,
    old_commission: existing.commission_amount,
    new_commission: item.commission_amount,
    original_date: existing.created_at
  }
}
```

### **Step 2: Send to TrafficPoint**

For items with `action: "send_to_pixel"`:

**HTTP Request:**
```javascript
POST {pixelUrl}
Headers:
  Cookie: {cookieHeader}
  Content-Type: application/x-www-form-urlencoded
Body (form-urlencoded):
  data: {JSON_PAYLOAD}
```

**JSON Payload (CRITICAL - Must be EXACT):**

```javascript
JSON.stringify({
  trackInfo: {
    tokenId: '',
    track_type: 'event',
    date: item.date,  // e.g., "2025-12-07T12:00:00"
    timestamp: new Date().toISOString().replace('Z', '000000Z')  // e.g., "2025-12-07T15:30:45.123456Z"
  },
  params: {
    commission_amount: item.commission_amount,
    currency: item.currency,
    amount: item.amount,
    ioId: item.io_id
  },
  trxId: item.trx_id,
  eventName: item.event.toLowerCase(),
  source_token: `${item.token}`,
  parent_api_call: JSON.stringify({
    parent_api_call: item.parent_api_call,
    script_id: scriptId,  // From node parameter
    fico: item.parent_api_call.includes('fico') 
      ? item.parent_api_call.substring(item.parent_api_call.indexOf('fico:') + 5) 
      : null
  })
})
```

**Expected Response:**
```javascript
{ "status": "OK" }
// or
{ "status": "ERROR", "error": "Error message" }
```

### **Step 3: Database Insert/Update**

For successful sends (status === "OK"):

**For NEW records:**
```sql
INSERT INTO scraper_tokens 
  (trx_id, amount, commission_amount, stream, created_at) 
VALUES 
  (?, ?, ?, 'scraper', NOW())
```

**For UPDATED records:**
```sql
UPDATE scraper_tokens 
SET 
  amount = ?,
  commission_amount = ?,
  created_at = NOW()
WHERE trx_id = ?
```

---

## Output Schema

### **Regular Output (Success)**

```javascript
{
  "execution": {
    "mode": "regular",
    "dry_run": false,
    "script_id": "3000",
    "timestamp": "2025-12-07T15:30:45.123Z",
    "duration_ms": 2341
  },
  "summary": {
    "total_input": 50,                    // Total items received
    "new_items": 35,                      // Never seen before
    "exact_duplicates": 8,                // trx_id + amount + commission all match
    "updated_items": 7,                   // trx_id exists but amount/commission changed
    "sent_to_pixel": 42,                  // new (35) + updated (7)
    "pixel_success": 40,                  // TrafficPoint returned OK
    "pixel_failed": 2,                    // TrafficPoint returned ERROR
    "db_inserted": 35,                    // New records inserted
    "db_updated": 5                       // Existing records updated (2 failed pixel)
  },
  "details": {
    "exact_duplicates": [
      {
        "trx_id": "brand-sale-123",
        "amount": 500,
        "commission_amount": 100,
        "first_seen": "2025-12-01T12:00:00Z",
        "action": "skipped"
      },
      // ... all 8 exact duplicates
    ],
    "updated_items": [
      {
        "trx_id": "brand-sale-456",
        "action": "updated_and_sent",
        "changes": {
          "old_amount": 500,
          "new_amount": 550,
          "old_commission": 100,
          "new_commission": 110,
          "first_seen": "2025-12-05T12:00:00Z"
        },
        "pixel_status": "OK"
      },
      {
        "trx_id": "brand-ftd-789",
        "action": "updated_and_sent",
        "changes": {
          "old_amount": 0,
          "new_amount": 0,
          "old_commission": 50,
          "new_commission": 75,
          "first_seen": "2025-12-06T12:00:00Z"
        },
        "pixel_status": "OK"
      }
      // ... all 7 updated items
    ],
    "failed_sends": [
      {
        "trx_id": "brand-sale-999",
        "io_id": "545f...",
        "error": "Timeout after 30s",
        "amount": 500,
        "commission_amount": 100,
        "was_update": false
      },
      {
        "trx_id": "brand-lead-888",
        "io_id": "545f...",
        "error": "Invalid io_id",
        "amount": 0,
        "commission_amount": 0,
        "was_update": true,
        "changes": {
          "old_amount": 0,
          "new_amount": 0,
          "old_commission": 40,
          "new_commission": 45
        }
      }
    ],
    "new_items_sample": [
      {
        "trx_id": "brand-sale-111",
        "amount": 600,
        "commission_amount": 120,
        "event": "sale",
        "pixel_status": "OK"
      }
      // ... first 5 new items
    ]
  },
  "metrics": {
    "mysql_check_ms": 120,
    "pixel_send_ms": 2100,
    "db_write_ms": 121
  }
}
```

### **Dry Run Output**

```javascript
{
  "execution": {
    "mode": "regular",
    "dry_run": true,
    "script_id": "3000",
    "timestamp": "2025-12-07T15:30:45.123Z",
    "duration_ms": 156
  },
  "summary": {
    "total_input": 50,
    "new_items": 35,
    "exact_duplicates": 8,
    "updated_items": 7,
    "would_send_to_pixel": 42,
    "status": "DRY_RUN_SKIPPED"
  },
  "details": {
    "exact_duplicates": [...],
    "updated_items": [...],
    "new_items_preview": [...]
  },
  "metrics": {
    "mysql_check_ms": 156
  }
}
```

### **Error Output**

```javascript
{
  "execution": {
    "mode": "regular",
    "dry_run": false,
    "script_id": "3000",
    "timestamp": "2025-12-07T15:30:45.123Z",
    "duration_ms": 1234,
    "success": false
  },
  "error": {
    "code": "MYSQL_CONNECTION_ERROR",
    "message": "Failed to connect to MySQL database",
    "details": "Connection timeout after 10s",
    "stage": "deduplication_check"
  },
  "summary": {
    "total_input": 50,
    "processed": 0
  }
}
```

---

## Database Schema

### scraper_tokens Table

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

---

## Logging Examples

### **Console Output (Verbose Mode)**

```
[Ryze Pixel Sender] Script: 3000
[Ryze Pixel Sender] Received: 50 items
[Ryze Pixel Sender] Checking duplicates against MySQL...
[Ryze Pixel Sender] ✓ Found 15 existing records in DB
[Ryze Pixel Sender] 
[Ryze Pixel Sender] Deduplication Results:
[Ryze Pixel Sender]   • New items: 35
[Ryze Pixel Sender]   • Exact duplicates: 8 (skipping)
[Ryze Pixel Sender]   • Updated items: 7 (will resend)
[Ryze Pixel Sender] 
[Ryze Pixel Sender] Updated Items Details:
[Ryze Pixel Sender]   1. brand-sale-456
[Ryze Pixel Sender]      OLD: amount=$500, commission=$100
[Ryze Pixel Sender]      NEW: amount=$550, commission=$110
[Ryze Pixel Sender]      First seen: 2025-12-05
[Ryze Pixel Sender]   2. brand-ftd-789
[Ryze Pixel Sender]      OLD: amount=$0, commission=$50
[Ryze Pixel Sender]      NEW: amount=$0, commission=$75
[Ryze Pixel Sender]      First seen: 2025-12-06
[Ryze Pixel Sender]   ... (5 more)
[Ryze Pixel Sender] 
[Ryze Pixel Sender] Sending 42 items to TrafficPoint...
[Ryze Pixel Sender] ✓ TrafficPoint Success: 40/42
[Ryze Pixel Sender] ✗ TrafficPoint Failed: 2/42
[Ryze Pixel Sender] 
[Ryze Pixel Sender] Failed Items:
[Ryze Pixel Sender]   • brand-sale-999: Timeout after 30s
[Ryze Pixel Sender]   • brand-lead-888: Invalid io_id (was update)
[Ryze Pixel Sender] 
[Ryze Pixel Sender] Database Updates:
[Ryze Pixel Sender]   • Inserted: 35 new records
[Ryze Pixel Sender]   • Updated: 5 existing records
[Ryze Pixel Sender] 
[Ryze Pixel Sender] ✓ Completed in 2.3s
```

---

## Error Handling

### **MySQL Connection Errors**

```javascript
{
  error: {
    code: "MYSQL_CONNECTION_ERROR",
    message: "Failed to connect to MySQL",
    stage: "deduplication_check"
  }
}
```

### **TrafficPoint API Errors**

```javascript
{
  error: {
    code: "TRAFFICPOINT_API_ERROR",
    message: "Pixel endpoint returned 500",
    stage: "pixel_send",
    affected_items: 42
  }
}
```

### **Partial Success Handling**

If some items succeed and some fail:
- Continue processing
- Report successes and failures separately
- Insert successful items to DB
- Return detailed breakdown in output

---

## Performance Considerations

### **Batch MySQL Query**

```sql
-- Bad: N queries (one per item)
SELECT * FROM scraper_tokens WHERE trx_id = 'brand-sale-123';
SELECT * FROM scraper_tokens WHERE trx_id = 'brand-sale-456';
-- ... 50 times

-- Good: 1 query for all items
SELECT * FROM scraper_tokens 
WHERE trx_id IN ('brand-sale-123', 'brand-sale-456', ..., 'brand-sale-999');
```

### **Batch Database Insert/Update**

```sql
-- For new records (batch insert):
INSERT INTO scraper_tokens 
  (trx_id, amount, commission_amount, stream, created_at) 
VALUES 
  ('brand-sale-111', 600, 120, 'scraper', NOW()),
  ('brand-sale-222', 700, 140, 'scraper', NOW()),
  ('brand-sale-333', 800, 160, 'scraper', NOW');

-- For updates (can be batched with CASE):
UPDATE scraper_tokens 
SET 
  amount = CASE trx_id
    WHEN 'brand-sale-456' THEN 550
    WHEN 'brand-ftd-789' THEN 0
    ELSE amount
  END,
  commission_amount = CASE trx_id
    WHEN 'brand-sale-456' THEN 110
    WHEN 'brand-ftd-789' THEN 75
    ELSE commission_amount
  END,
  created_at = NOW()
WHERE trx_id IN ('brand-sale-456', 'brand-ftd-789');
```

### **Expected Performance**

- 50 items: ~2-3 seconds
- 200 items: ~8-10 seconds
- 500 items: ~20-25 seconds

---

## Testing Checklist

### **Unit Tests**

- [ ] Handles empty input
- [ ] Handles single item
- [ ] Handles 100+ items
- [ ] Detects exact duplicates correctly
- [ ] Detects updated items correctly
- [ ] Generates correct TrafficPoint payload
- [ ] Handles MySQL connection failure
- [ ] Handles TrafficPoint API failure
- [ ] Handles partial success (some items fail)
- [ ] Dry run mode works correctly
- [ ] Skip dedup mode works correctly

### **Integration Tests**

- [ ] Connects to real MySQL
- [ ] Connects to real TrafficPoint
- [ ] Inserts new records correctly
- [ ] Updates existing records correctly
- [ ] Handles concurrent executions
- [ ] Handles duplicate concurrent requests

---

## Migration from Current Workflows

### **Before (8 nodes):**

```
Filter
  ↓
Check MySQL (per item)
  ↓
Merge (SQL: exclude duplicates)
  ↓
Send to TrafficPoint
  ↓
Merge Responses
  ↓
IF Status OK
  ↓
MySQL Insert
  ↓
Done
```

### **After (1 node):**

```
Ryze Pixel Sender
  ↓
Done
```

### **Configuration:**

```
Script ID: 3000
Pixel URL: (default)
Credentials: MySQL + TrafficPoint API
Dry Run: OFF (production)
```

---

## Example Use Cases

### **Use Case 1: Standard Deduplication**

**Input:** 50 events from processors  
**Expected:** Skip exact duplicates, send new items  
**Output:** 42 sent (35 new + 7 updated), 8 skipped

### **Use Case 2: Corrected Commission**

**Scenario:** Partner sends correction - same trx_id but updated commission  
**Input:** trx_id exists with commission $50, new data has $75  
**Expected:** Send to pixel, update DB  
**Output:** Marked as "updated", detailed change log

### **Use Case 3: Dry Run Testing**

**Scenario:** Testing new workflow configuration  
**Input:** Any data  
**Expected:** Check duplicates, show what would happen, don't actually send  
**Output:** Full breakdown without side effects

### **Use Case 4: Re-processing**

**Scenario:** Need to resend all data (e.g., after pixel outage)  
**Input:** Historical data  
**Config:** Skip Deduplication = ON  
**Expected:** Send everything regardless of DB  
**Output:** All items sent

---

## Security Considerations

- ✅ Credentials stored securely in n8n credential system
- ✅ SQL injection prevention (parameterized queries)
- ✅ No sensitive data in logs (can be configured)
- ✅ Cookie header never logged
- ✅ Database passwords encrypted at rest

---

## Support & Troubleshooting

### **Common Issues**

**Issue:** "Items sent but not in database"
- Check: IF Status OK node logic
- Check: MySQL connection
- Check: Transaction IDs for special characters

**Issue:** "Too many duplicates detected"
- Check: Date format in input (must end with T12:00:00)
- Check: trx_id uniqueness across workflows
- Check: MySQL query performance

**Issue:** "TrafficPoint returns errors"
- Check: Cookie header is current
- Check: Payload format matches exactly
- Check: io_id exists in TrafficPoint system

---

## Future Enhancements

- [ ] Retry logic for failed pixel sends
- [ ] Rate limiting for TrafficPoint API
- [ ] Webhook notifications on failures
- [ ] Metrics export to monitoring system
- [ ] Support for multiple pixel endpoints
- [ ] Advanced deduplication rules (time windows)

---

## Version History

**v0.1.0** - Initial release
- Basic deduplication
- TrafficPoint integration
- MySQL storage
- Dry run mode

---

**Questions? Contact: ohad.cohen@ryzebeyond.com**