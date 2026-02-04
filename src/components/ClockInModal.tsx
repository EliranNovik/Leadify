import React, { useState, useEffect } from 'react';
import { XMarkIcon, ClockIcon, MapPinIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';

interface ClockInModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  userId: string;
}

interface LocationData {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  city: string | null;
  country: string | null;
  source: 'browser' | 'ip' | 'manual';
}

interface ClockInRecord {
  id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  location_address: string | null;
  is_active: boolean;
}

const ClockInModal: React.FC<ClockInModalProps> = ({ isOpen, onClose, employeeId, userId }) => {
  const { user } = useAuthContext();
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ClockInRecord | null>(null);
  const [location, setLocation] = useState<LocationData>({
    latitude: null,
    longitude: null,
    address: null,
    city: null,
    country: null,
    source: 'browser',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [todayRecords, setTodayRecords] = useState<ClockInRecord[]>([]);
  const [notes, setNotes] = useState('');

  // Fetch current clock-in status and today's records
  useEffect(() => {
    if (isOpen && employeeId) {
      fetchClockInStatus();
      fetchTodayRecords();
    }
  }, [isOpen, employeeId]);

  // Get user's location when modal opens
  useEffect(() => {
    if (isOpen) {
      getLocation();
    }
  }, [isOpen]);

  const getLocation = async () => {
    setIsGettingLocation(true);
    try {
      // Try browser geolocation first
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Try to reverse geocode the coordinates
            try {
              const response = await fetch(
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
              );
              const data = await response.json();
              
              setLocation({
                latitude: lat,
                longitude: lng,
                address: data.locality || data.principalSubdivision || null,
                city: data.city || data.locality || null,
                country: data.countryName || null,
                source: 'browser',
              });
            } catch (error) {
              // If reverse geocoding fails, just use coordinates
              setLocation({
                latitude: lat,
                longitude: lng,
                address: null,
                city: null,
                country: null,
                source: 'browser',
              });
            }
          },
          async (error) => {
            console.warn('Geolocation error:', error);
            // Fallback to IP-based location
            try {
              const response = await fetch('https://ipapi.co/json/');
              const data = await response.json();
              setLocation({
                latitude: data.latitude || null,
                longitude: data.longitude || null,
                address: data.city ? `${data.city}, ${data.region}` : null,
                city: data.city || null,
                country: data.country_name || null,
                source: 'ip',
              });
            } catch (ipError) {
              console.warn('IP location error:', ipError);
              setLocation({
                latitude: null,
                longitude: null,
                address: 'Location unavailable',
                city: null,
                country: null,
                source: 'manual',
              });
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        );
      } else {
        // Fallback to IP-based location
        try {
          const response = await fetch('https://ipapi.co/json/');
          const data = await response.json();
          setLocation({
            latitude: data.latitude || null,
            longitude: data.longitude || null,
            address: data.city ? `${data.city}, ${data.region}` : null,
            city: data.city || null,
            country: data.country_name || null,
            source: 'ip',
          });
        } catch (error) {
          setLocation({
            latitude: null,
            longitude: null,
            address: 'Location unavailable',
            city: null,
            country: null,
            source: 'manual',
          });
        }
      }
    } catch (error) {
      console.error('Error getting location:', error);
      setLocation({
        latitude: null,
        longitude: null,
        address: 'Location unavailable',
        city: null,
        country: null,
        source: 'manual',
      });
    } finally {
      setIsGettingLocation(false);
    }
  };

  const fetchClockInStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .order('clock_in_time', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setIsClockedIn(true);
        setCurrentRecord(data);
      } else {
        setIsClockedIn(false);
        setCurrentRecord(null);
      }
    } catch (error) {
      console.error('Error fetching clock-in status:', error);
      toast.error('Failed to fetch clock-in status');
    }
  };

  const fetchTodayRecords = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStart = today.toISOString();
      const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('employee_clock_in')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('clock_in_time', todayStart)
        .lt('clock_in_time', todayEnd)
        .order('clock_in_time', { ascending: false });

      if (error) throw error;

      setTodayRecords(data || []);
    } catch (error) {
      console.error('Error fetching today records:', error);
    }
  };

  const handleClockIn = async () => {
    if (!employeeId || !userId) {
      toast.error('Missing employee or user information');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_clock_in')
        .insert({
          employee_id: employeeId,
          user_id: userId,
          clock_in_time: new Date().toISOString(),
          location_latitude: location.latitude,
          location_longitude: location.longitude,
          location_address: location.address,
          location_city: location.city,
          location_country: location.country,
          location_source: location.source,
          notes: notes.trim() || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      setIsClockedIn(true);
      setCurrentRecord(data);
      setNotes('');
      toast.success('Clocked in successfully!');
      fetchTodayRecords();
    } catch (error: any) {
      console.error('Error clocking in:', error);
      toast.error(error.message || 'Failed to clock in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!currentRecord) {
      toast.error('No active clock-in record found');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('employee_clock_in')
        .update({
          clock_out_time: new Date().toISOString(),
          is_active: false,
          notes: notes.trim() || currentRecord.notes || null,
        })
        .eq('id', currentRecord.id);

      if (error) throw error;

      setIsClockedIn(false);
      setCurrentRecord(null);
      setNotes('');
      toast.success('Clocked out successfully!');
      fetchTodayRecords();
    } catch (error: any) {
      console.error('Error clocking out:', error);
      toast.error(error.message || 'Failed to clock out');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return 'In progress...';
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const diffMs = endTime - startTime;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const calculateTodayTotal = () => {
    let totalMs = 0;
    todayRecords.forEach((record) => {
      const start = new Date(record.clock_in_time).getTime();
      const end = record.clock_out_time
        ? new Date(record.clock_out_time).getTime()
        : new Date().getTime();
      totalMs += end - start;
    });
    const hours = Math.floor(totalMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl transform transition-all">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Clock In/Out</h2>
                <p className="text-sm text-gray-500">Track your work hours</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-sm btn-ghost btn-circle"
              title="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Current Status */}
            <div className={`p-4 rounded-xl border-2 ${
              isClockedIn
                ? 'bg-green-50 border-green-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    isClockedIn ? 'bg-green-500' : 'bg-gray-400'
                  }`}>
                    <CheckCircleIcon className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Current Status</p>
                    <p className={`text-lg font-bold ${
                      isClockedIn ? 'text-green-700' : 'text-gray-700'
                    }`}>
                      {isClockedIn ? 'Clocked In' : 'Clocked Out'}
                    </p>
                    {isClockedIn && currentRecord && (
                      <p className="text-xs text-gray-500 mt-1">
                        Since {formatTime(currentRecord.clock_in_time)}
                      </p>
                    )}
                  </div>
                </div>
                {isClockedIn && currentRecord && (
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Duration</p>
                    <p className="text-lg font-bold text-green-700">
                      {formatDuration(currentRecord.clock_in_time, currentRecord.clock_out_time)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Location Info */}
            <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start gap-3">
                <MapPinIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-900">Location</p>
                  {isGettingLocation ? (
                    <p className="text-sm text-blue-700 mt-1">Detecting location...</p>
                  ) : (
                    <p className="text-sm text-blue-700 mt-1">
                      {location.address || location.city || 'Location unavailable'}
                      {location.country && `, ${location.country}`}
                    </p>
                  )}
                  {location.latitude && location.longitude && (
                    <p className="text-xs text-blue-600 mt-1">
                      {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (optional)
              </label>
              <textarea
                className="textarea textarea-bordered w-full"
                placeholder="Add any notes about your clock-in/out..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              {!isClockedIn ? (
                <button
                  onClick={handleClockIn}
                  disabled={isLoading || isGettingLocation}
                  className="btn btn-primary flex-1"
                >
                  {isLoading ? (
                    <span className="loading loading-spinner"></span>
                  ) : (
                    <>
                      <ClockIcon className="w-5 h-5" />
                      Clock In
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleClockOut}
                  disabled={isLoading}
                  className="btn btn-error flex-1"
                >
                  {isLoading ? (
                    <span className="loading loading-spinner"></span>
                  ) : (
                    <>
                      <ClockIcon className="w-5 h-5" />
                      Clock Out
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Today's Records */}
            {todayRecords.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Today's Records</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {todayRecords.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            {formatTime(record.clock_in_time)}
                          </span>
                          <span className="text-gray-400">→</span>
                          <span className="text-sm text-gray-600">
                            {record.clock_out_time
                              ? formatTime(record.clock_out_time)
                              : 'In progress...'}
                          </span>
                        </div>
                        {record.location_address && (
                          <p className="text-xs text-gray-500 mt-1">
                            📍 {record.location_address}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-700">
                          {formatDuration(record.clock_in_time, record.clock_out_time)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Total Today</span>
                    <span className="text-lg font-bold text-purple-600">
                      {calculateTodayTotal()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClockInModal;
