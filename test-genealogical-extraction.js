// Test script for genealogical data extraction
// Run this in browser console to test the enhanced meeting summary system

const testGenealogicalExtraction = async () => {
  console.log('🧬 Testing Genealogical Data Extraction...');
  
  // Sample transcript with genealogical and persecution data
  const sampleTranscript = `
  Client: My grandfather, Moshe Cohen, was born in Vienna, Austria on March 15, 1920. 
  His parents were David Cohen and Sarah Rosenberg. David was born in 1895 in Krakow, Poland, 
  and Sarah was born in 1898 in Budapest, Hungary. They moved to Vienna in 1918.
  
  Moshe was persecuted during the Holocaust. He was arrested in Vienna in 1938 and sent to 
  Dachau concentration camp. He escaped in 1940 and fled to Switzerland, then emigrated to 
  Palestine in 1942. His parents were deported to Auschwitz in 1941 and never returned.
  
  I have their birth certificates, marriage certificate from 1917, and some immigration papers 
  from when they first came to Vienna. My great-grandparents on my grandmother's side were 
  Isaac and Rachel Goldstein from Warsaw, Poland. They were also killed in the Holocaust.
  
  I need help with German citizenship restoration based on this persecution history.
  `;

  const testRequest = {
    meetingId: 'test-genealogical-123',
    clientId: 'test-client-456',
    transcriptText: sampleTranscript,
    meetingSubject: 'Genealogical Data Review',
    meetingStartTime: '2024-01-15T10:00:00Z',
    meetingEndTime: '2024-01-15T11:00:00Z'
  };

  try {
    console.log('📝 Sample Transcript:');
    console.log(sampleTranscript);
    console.log('\n📊 Expected Extracted Data:');
    
    const expectedData = {
      persecuted_person: {
        full_name: 'Moshe Cohen',
        birth_date: 'March 15, 1920',
        birth_place: 'Vienna, Austria',
        country_of_origin: 'Austria',
        persecution_type: 'Holocaust',
        persecution_dates: '1938-1940',
        persecution_location: 'Dachau concentration camp',
        entry_germany_date: null,
        entry_austria_date: '1918 (family)',
        left_germany_date: null,
        left_austria_date: '1940',
        emigration_destination: 'Palestine',
        emigration_date: '1942'
      },
      family_members: {
        parents: [
          { name: 'David Cohen', birth_date: '1895', birth_place: 'Krakow, Poland' },
          { name: 'Sarah Rosenberg', birth_date: '1898', birth_place: 'Budapest, Hungary' }
        ],
        grandparents: [],
        great_grandparents: [
          { name: 'Isaac Goldstein', birth_place: 'Warsaw, Poland' },
          { name: 'Rachel Goldstein', birth_place: 'Warsaw, Poland' }
        ]
      },
      documents_mentioned: [
        'Birth certificates',
        'Marriage certificate from 1917',
        'Immigration papers'
      ],
      persecution_details: {
        specific_events: ['Arrested in Vienna in 1938', 'Sent to Dachau', 'Escaped in 1940'],
        locations: ['Vienna', 'Dachau concentration camp', 'Switzerland', 'Palestine', 'Auschwitz'],
        dates: ['1938', '1940', '1941', '1942'],
        types: ['Holocaust', 'Deportation', 'Concentration camp']
      }
    };
    
    console.log(JSON.stringify(expectedData, null, 2));
    
    console.log('\n🚀 To test with real API:');
    console.log(`
    // Call the meeting summary function
    const result = await processMeetingSummary(${JSON.stringify(testRequest)});
    console.log('API Response:', result);
    `);
    
    console.log('\n✅ Test completed! The system should extract:');
    console.log('• Persecuted person details (Moshe Cohen)');
    console.log('• Family members (parents, great-grandparents)');
    console.log('• Documents mentioned');
    console.log('• Persecution events and locations');
    console.log('• Entry/exit dates for Austria');
    console.log('• Emigration details');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Test Hebrew transcript
const testHebrewTranscript = async () => {
  console.log('\n🇮🇱 Testing Hebrew Transcript...');
  
  const hebrewTranscript = `
  לקוח: סבא שלי, משה כהן, נולד בווינה, אוסטריה ב-15 במרץ 1920.
  ההורים שלו היו דוד כהן ושרה רוזנברג. דוד נולד ב-1895 בקרקוב, פולין,
  ושרה נולדה ב-1898 בבודפשט, הונגריה. הם עברו לווינה ב-1918.
  
  משה נרדף במהלך השואה. הוא נעצר בווינה ב-1938 ונשלח למחנה הריכוז דכאו.
  הוא ברח ב-1940 ונמלט לשוויץ, ואז היגר לפלשתינה ב-1942. ההורים שלו
  גורשו לאושוויץ ב-1941 ולא חזרו.
  
  יש לי את תעודות הלידה שלהם, תעודת נישואין מ-1917, וכמה מסמכי הגירה
  מהפעם הראשונה שהם הגיעו לווינה. הסבא רבא שלי מצד סבתא היו
  יצחק ורחל גולדשטיין מוורשה, פולין. גם הם נהרגו בשואה.
  
  אני צריך עזרה עם החזרת אזרחות גרמנית על בסיס היסטוריית הרדיפה הזו.
  `;
  
  console.log('📝 Hebrew Transcript:');
  console.log(hebrewTranscript);
  console.log('\n🔍 The system should detect Hebrew language and extract the same data in Hebrew and English summaries.');
};

// Run tests
const runAllTests = () => {
  console.log('🧪 Starting Genealogical Data Extraction Tests...\n');
  testGenealogicalExtraction();
  testHebrewTranscript();
};

// Auto-run tests
runAllTests();
