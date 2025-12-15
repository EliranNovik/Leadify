/**
 * Migration script to fix date fields in call_logs table
 * 
 * This script fixes dates that were incorrectly stored due to UTC timezone conversion.
 * It extracts the date directly from the cdate field (which stores OneCom's original format)
 * without timezone conversion.
 * 
 * Usage:
 *   node fix-call-logs-dates.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be updated without actually updating the database
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Check for dry-run flag
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');

if (isDryRun) {
  console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
}

/**
 * Extract date and time from OneCom date string format: "YYYY-MM-DD HH:MM:SS"
 * Returns { date: "YYYY-MM-DD", time: "HH:MM:SS" } or null if parsing fails
 */
function extractDateFromOneComString(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  // Try to match format "YYYY-MM-DD HH:MM:SS"
  const dateTimeMatch = dateString.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (dateTimeMatch) {
    return {
      date: dateTimeMatch[1], // YYYY-MM-DD
      time: dateTimeMatch[2]    // HH:MM:SS
    };
  }

  // Try to parse as ISO date string
  try {
    const dateObj = new Date(dateString);
    if (!isNaN(dateObj.getTime())) {
      // Use local date components to avoid timezone issues
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const seconds = String(dateObj.getSeconds()).padStart(2, '0');
      
      return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`
      };
    }
  } catch (error) {
    // Ignore parsing errors
  }

  return null;
}

/**
 * Extract date from onecom_raw_data JSON field
 */
function extractDateFromRawData(rawData) {
  if (!rawData) return null;

  try {
    let parsed;
    if (typeof rawData === 'string') {
      parsed = JSON.parse(rawData);
    } else {
      parsed = rawData;
    }

    if (parsed && parsed.start) {
      return extractDateFromOneComString(parsed.start);
    }
  } catch (error) {
    // Ignore parsing errors
  }

  return null;
}

async function fixCallLogsDates() {
  console.log('🔄 Starting call logs date fix migration...\n');

  try {
    // Fetch all call logs that have cdate or onecom_raw_data
    // Process in batches to avoid memory issues
    const batchSize = 1000;
    let offset = 0;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    while (true) {
      console.log(`📊 Fetching batch starting at offset ${offset}...`);

      const { data: callLogs, error: fetchError } = await supabase
        .from('call_logs')
        .select('id, cdate, date, time, onecom_raw_data')
        .or('cdate.not.is.null,onecom_raw_data.not.is.null')
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (fetchError) {
        console.error('❌ Error fetching call logs:', fetchError);
        break;
      }

      if (!callLogs || callLogs.length === 0) {
        console.log('✅ No more call logs to process.');
        break;
      }

      console.log(`   Found ${callLogs.length} call logs in this batch`);

      // Process each call log
      const updates = [];
      for (const callLog of callLogs) {
        totalProcessed++;

        // Try to extract date from cdate first, then from onecom_raw_data
        let extractedDate = null;
        
        if (callLog.cdate) {
          extractedDate = extractDateFromOneComString(callLog.cdate);
        }

        if (!extractedDate && callLog.onecom_raw_data) {
          extractedDate = extractDateFromRawData(callLog.onecom_raw_data);
        }

        if (!extractedDate) {
          totalSkipped++;
          continue; // Skip if we can't extract date
        }

        // Check if date needs to be updated
        const needsUpdate = 
          callLog.date !== extractedDate.date || 
          callLog.time !== extractedDate.time;

        if (needsUpdate) {
          updates.push({
            id: callLog.id,
            date: extractedDate.date,
            time: extractedDate.time
          });
        } else {
          totalSkipped++;
        }
      }

      // Batch update the records
      if (updates.length > 0) {
        if (isDryRun) {
          console.log(`   Would update ${updates.length} call logs:`);
          // Show first 5 examples
          updates.slice(0, 5).forEach(update => {
            const original = callLogs.find(cl => cl.id === update.id);
            console.log(`     - ID ${update.id}: date "${original?.date || 'NULL'}" -> "${update.date}", time "${original?.time || 'NULL'}" -> "${update.time}"`);
          });
          if (updates.length > 5) {
            console.log(`     ... and ${updates.length - 5} more`);
          }
          totalUpdated += updates.length; // Count as updated for dry-run stats
        } else {
          console.log(`   Updating ${updates.length} call logs...`);

          // Update in smaller batches to avoid query size limits
          const updateBatchSize = 100;
          for (let i = 0; i < updates.length; i += updateBatchSize) {
            const batch = updates.slice(i, i + updateBatchSize);
            
            for (const update of batch) {
              const { error: updateError } = await supabase
                .from('call_logs')
                .update({
                  date: update.date,
                  time: update.time
                })
                .eq('id', update.id);

              if (updateError) {
                console.error(`   ❌ Error updating call log ${update.id}:`, updateError.message);
                totalErrors++;
              } else {
                totalUpdated++;
              }
            }
          }

          console.log(`   ✅ Updated ${updates.length} call logs in this batch`);
        }
      }

      // Move to next batch
      offset += batchSize;

      // If we got fewer records than batch size, we're done
      if (callLogs.length < batchSize) {
        break;
      }

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n' + '='.repeat(60));
    if (isDryRun) {
      console.log('✅ Dry run completed! (No changes made)');
    } else {
      console.log('✅ Migration completed!');
    }
    console.log('='.repeat(60));
    console.log(`Total processed: ${totalProcessed}`);
    if (isDryRun) {
      console.log(`Would update: ${totalUpdated}`);
    } else {
      console.log(`Total updated: ${totalUpdated}`);
    }
    console.log(`Total skipped (no change needed): ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log('='.repeat(60));
    
    if (isDryRun) {
      console.log('\n💡 To apply these changes, run without --dry-run flag:');
      console.log('   node fix-call-logs-dates.js\n');
    }

  } catch (error) {
    console.error('❌ Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
fixCallLogsDates()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

