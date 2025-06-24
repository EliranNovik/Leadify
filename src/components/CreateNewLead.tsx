import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const sources = [
  '',
  'Website',
  'Referral',
  'Phone',
  'Email',
  'Social Media',
  'Other',
];

const languages = [
  '',
  'English',
  'Hebrew',
  'German',
  'French',
  'Russian',
  'Other',
];

interface NewLeadResult {
  id: string;
  lead_number: string;
  name: string;
  email: string;
}

const CreateNewLead: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    source: '',
    language: '',
    topic: '',
    facts: '',
    specialNotes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Call the new database function to create the lead
      const { data, error } = await supabase.rpc('create_new_lead_v2', {
        lead_name: form.name,
        lead_email: form.email,
        lead_phone: form.phone,
        lead_topic: form.topic,
        lead_language: form.language,
      });

      if (error) throw error;
      const newLead = data?.[0] as NewLeadResult;
      if (!newLead) throw new Error("Could not create lead.");

      // Navigate to the new lead's page
      navigate(`/clients/${newLead.lead_number}`);
    } catch (error) {
      console.error('Error creating lead:', error);
      alert('Failed to create lead. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Create New Lead</h1>
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div>
          <label className="block font-semibold mb-1">Name:</label>
          <input
            type="text"
            name="name"
            className="input input-bordered w-full"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Email:</label>
          <input
            type="email"
            name="email"
            className="input input-bordered w-full"
            value={form.email}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Phone:</label>
          <input
            type="tel"
            name="phone"
            className="input input-bordered w-full"
            value={form.phone}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Source:</label>
          <select
            name="source"
            className="select select-bordered w-full"
            value={form.source}
            onChange={handleChange}
            required
          >
            <option value="">----------</option>
            {sources.slice(1).map((src) => (
              <option key={src} value={src}>{src}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Language:</label>
          <select
            name="language"
            className="select select-bordered w-full"
            value={form.language}
            onChange={handleChange}
            required
          >
            <option value="">----------</option>
            {languages.slice(1).map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">Topic:</label>
          <input
            type="text"
            name="topic"
            className="input input-bordered w-full"
            value={form.topic}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Facts of Case:</label>
          <textarea
            name="facts"
            className="textarea textarea-bordered w-full min-h-[120px]"
            value={form.facts}
            onChange={handleChange}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Special notes:</label>
          <textarea
            name="specialNotes"
            className="textarea textarea-bordered w-full min-h-[80px]"
            value={form.specialNotes}
            onChange={handleChange}
          />
        </div>
        <div className="pt-4">
          <button 
            type="submit" 
            className={`btn btn-primary w-full text-lg font-semibold ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateNewLead; 