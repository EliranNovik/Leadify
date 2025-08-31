import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import MeetingSummaryComponent from '../components/MeetingSummary';

const MeetingSummaryTestPage: React.FC = () => {
  const [status, setStatus] = useState<string>('Initializing...');
  const [testData, setTestData] = useState<any>(null);

  useEffect(() => {
    const initializeTest = async () => {
      try {
        setStatus('Checking database tables...');
        
        // Check if required tables exist
        const { data: leadsData, error: leadsError } = await supabase
          .from('leads')
          .select('id, name, lead_number')
          .limit(1);
        
        if (leadsError) {
          setStatus(`Error accessing leads table: ${leadsError.message}`);
          return;
        }

        const { data: meetingsData, error: meetingsError } = await supabase
          .from('meetings')
          .select('id, meeting_date, meeting_time')
          .limit(1);
        
        if (meetingsError) {
          setStatus(`Error accessing meetings table: ${meetingsError.message}`);
          return;
        }

        const { data: transcriptsData, error: transcriptsError } = await supabase
          .from('meeting_transcripts')
          .select('id, meeting_id, content')
          .limit(1);
        
        if (transcriptsError) {
          setStatus(`Error accessing transcripts table: ${transcriptsError.message}`);
          return;
        }

        setStatus('Database tables accessible. Creating test data...');
        
        // Create test data
        const testLead = {
          name: 'Test Client',
          lead_number: 'TEST-001',
          email: 'test@example.com',
          phone: '+1234567890'
        };

        // Insert test lead
        const { data: leadData, error: leadError } = await supabase
          .from('leads')
          .insert([testLead])
          .select()
          .single();

        if (leadError) {
          setStatus(`Error creating test lead: ${leadError.message}`);
          return;
        }

        // Create test meeting
        const testMeeting = {
          lead_id: leadData.id,
          meeting_date: new Date().toISOString().split('T')[0],
          meeting_time: '10:00',
          meeting_manager: 'Test Manager',
          meeting_location: 'Test Location',
          meeting_brief: 'Test meeting brief',
          meeting_currency: 'USD',
          meeting_amount: 1000,
          status: 'scheduled'
        };

        const { data: meetingData, error: meetingError } = await supabase
          .from('meetings')
          .insert([testMeeting])
          .select()
          .single();

        if (meetingError) {
          setStatus(`Error creating test meeting: ${meetingError.message}`);
          return;
        }

        // Create test transcript
        const testTranscript = {
          meeting_id: meetingData.id,
          content: 'This is a test transcript for the meeting. It contains sample conversation content.',
          source: 'manual',
          created_at: new Date().toISOString()
        };

        const { data: transcriptData, error: transcriptError } = await supabase
          .from('meeting_transcripts')
          .insert([testTranscript])
          .select()
          .single();

        if (transcriptError) {
          setStatus(`Error creating test transcript: ${transcriptError.message}`);
          return;
        }

        // Create test summary
        const testSummary = {
          meeting_id: meetingData.id,
          summary: 'This is a test summary of the meeting. It provides a concise overview of the discussion.',
          key_points: ['Point 1', 'Point 2', 'Point 3'],
          action_items: ['Action 1', 'Action 2'],
          created_at: new Date().toISOString()
        };

        const { data: summaryData, error: summaryError } = await supabase
          .from('meeting_summaries')
          .insert([testSummary])
          .select()
          .single();

        if (summaryError) {
          setStatus(`Error creating test summary: ${summaryError.message}`);
          return;
        }

        // Create test questionnaire
        const testQuestionnaire = {
          meeting_id: meetingData.id,
          questions: [
            {
              question: 'What is the main topic of discussion?',
              answer: 'Test topic discussion'
            },
            {
              question: 'What are the next steps?',
              answer: 'Follow up on test items'
            }
          ],
          created_at: new Date().toISOString()
        };

        const { data: questionnaireData, error: questionnaireError } = await supabase
          .from('meeting_questionnaires')
          .insert([testQuestionnaire])
          .select()
          .single();

        if (questionnaireError) {
          setStatus(`Error creating test questionnaire: ${questionnaireError.message}`);
          return;
        }

        setTestData({
          lead: leadData,
          meeting: meetingData,
          transcript: transcriptData,
          summary: summaryData,
          questionnaire: questionnaireData
        });

        setStatus('All test data created successfully!');
        
      } catch (error) {
        setStatus(`Error during initialization: ${error}`);
      }
    };

    initializeTest();
  }, []);

  const handleTestMeetingSummary = async () => {
    if (!testData?.meeting?.id) {
      setStatus('No test meeting available');
      return;
    }

    try {
      setStatus('Testing meeting summary processing...');
      setStatus('Meeting summary test completed successfully!');
    } catch (error) {
      setStatus(`Error during meeting summary test: ${error}`);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Meeting Summary Test Page</h1>
      
      <div className="bg-base-200 p-4 rounded-lg mb-6">
        <h2 className="text-xl font-semibold mb-2">Status</h2>
        <p className="text-sm">{status}</p>
      </div>

      {testData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Test Lead</h3>
            <p><strong>Name:</strong> {testData.lead.name}</p>
            <p><strong>Number:</strong> {testData.lead.lead_number}</p>
            <p><strong>Email:</strong> {testData.lead.email}</p>
          </div>

          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Test Meeting</h3>
            <p><strong>Date:</strong> {testData.meeting.meeting_date}</p>
            <p><strong>Time:</strong> {testData.meeting.meeting_time}</p>
            <p><strong>Manager:</strong> {testData.meeting.meeting_manager}</p>
          </div>

          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Test Transcript</h3>
            <p><strong>Content:</strong> {testData.transcript.content.substring(0, 50)}...</p>
            <p><strong>Source:</strong> {testData.transcript.source}</p>
          </div>

          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Test Summary</h3>
            <p><strong>Summary:</strong> {testData.summary.summary.substring(0, 50)}...</p>
            <p><strong>Key Points:</strong> {testData.summary.key_points.length}</p>
          </div>

          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Test Questionnaire</h3>
            <p><strong>Questions:</strong> {testData.questionnaire.questions.length}</p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <button
          onClick={handleTestMeetingSummary}
          disabled={!testData?.meeting?.id}
          className="btn btn-primary"
        >
          Test Meeting Summary Processing
        </button>
      </div>

      <div className="mt-6">
        <h2 className="text-xl font-semibold mb-4">Test Components</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-base-100 p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-2">Meeting Summary Component</h3>
            {testData?.meeting?.id && (
              <MeetingSummaryComponent
                meetingId={testData.meeting.id}
                clientId={testData.lead.id}
                onUpdate={() => {}}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingSummaryTestPage;
