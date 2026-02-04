import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    AcademicCapIcon,
    BuildingOfficeIcon,
    BriefcaseIcon,
    PhoneIcon,
    EnvelopeIcon,
    DevicePhoneMobileIcon,
} from '@heroicons/react/24/outline';
import { FaLinkedin, FaWhatsapp, FaEnvelope } from 'react-icons/fa';

// Default images if none provided
const DEFAULT_BANNER = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80';
const DEFAULT_AVATAR = 'https://ui-avatars.com/api/?background=random';

interface EmployeeProfile {
    id: number;
    display_name: string;
    photo_url: string;
    chat_background_image_url: string;
    mobile: string;
    phone: string;
    phone_ext: string;
    email: string | null;
    department_name: string;
    bonuses_role: string;
    official_name: string;
    school?: string;
    diplom?: string;
    linkedin_url?: string;
}

const PublicProfilePage: React.FC = () => {
    const { employeeId } = useParams<{ employeeId: string }>();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<EmployeeProfile | null>(null);

    useEffect(() => {
        if (employeeId) {
            fetchProfile();
        }
    }, [employeeId]);

    const fetchProfile = async () => {
        try {
            setLoading(true);

            const { data: employeeData, error: employeeError } = await supabase
                .from('tenants_employee')
                .select(`
                    id,
                    display_name,
                    photo_url,
                    chat_background_image_url,
                    mobile,
                    phone,
                    phone_ext,
                    bonuses_role,
                    official_name,
                    school,
                    diplom,
                    linkedin_url,
                    department_id,
                    tenant_departement!department_id (
                        name
                    )
                `)
                .eq('id', parseInt(employeeId || '0'))
                .single();

            if (employeeError) throw employeeError;

            if (employeeData) {
                const emp = employeeData as any;

                // Fetch email from users table using employee_id
                let email = null;
                const { data: userData } = await supabase
                    .from('users')
                    .select('email')
                    .eq('employee_id', emp.id)
                    .maybeSingle();

                if (userData) {
                    email = userData.email;
                }

                // Convert school array to string for display
                const schoolValue = Array.isArray(emp.school) && emp.school.length > 0
                    ? emp.school[0]
                    : (emp.school || '');

                const profileData = {
                    id: emp.id,
                    display_name: emp.display_name,
                    photo_url: emp.photo_url,
                    chat_background_image_url: emp.chat_background_image_url,
                    mobile: emp.mobile || '',
                    phone: emp.phone || '',
                    phone_ext: emp.phone_ext || '',
                    email: email,
                    department_name: emp.tenant_departement?.name || 'General',
                    bonuses_role: emp.bonuses_role || 'Employee',
                    official_name: emp.official_name || emp.display_name,
                    school: schoolValue,
                    diplom: emp.diplom || '',
                    linkedin_url: emp.linkedin_url || ''
                };

                setProfile(profileData);
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const getRoleDisplay = (role: string) => {
        const roleMap: Record<string, string> = {
            'c': 'Closer', 's': 'Scheduler', 'h': 'Handler', 'n': 'No role',
            'e': 'Expert', 'z': 'Manager', 'Z': 'Manager', 'ma': 'Marketing',
            'p': 'Partner', 'helper-closer': 'Helper Closer', 'pm': 'Project Manager',
            'se': 'Secretary', 'dv': 'Developer', 'dm': 'Department Manager',
            'b': 'Book Keeper', 'f': 'Finance'
        };
        return roleMap[role] || role;
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-800">Profile Not Found</h2>
                    <p className="text-gray-500 mt-2">Could not load employee profile details.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white flex flex-col">
            {/* Banner Section */}
            <div className="relative h-64 md:h-80 w-full group">
                <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${profile.chat_background_image_url || DEFAULT_BANNER})`,
                    }}
                >
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors"></div>
                </div>

                {/* Logo */}
                <div className="absolute top-6 left-6 z-20">
                    <img
                        src="/DPLOGO1.png"
                        alt="DPL Logo"
                        className="h-14 md:h-20 drop-shadow-lg"
                    />
                </div>

                {/* Profile Header Content - Avatar overlaps banner and white bg */}
                <div className="absolute -bottom-20 md:-bottom-20 left-0 right-0 px-4 md:px-8 max-w-5xl mx-auto flex flex-col md:flex-row items-center md:items-start gap-4 md:gap-6 pointer-events-none">
                    {/* Avatar */}
                    <div className="relative group/avatar pointer-events-auto shrink-0">
                        <div className="w-28 h-28 md:w-40 md:h-40 rounded-full border-4 border-white shadow-xl overflow-hidden bg-white">
                            <img
                                src={profile.photo_url || DEFAULT_AVATAR}
                                alt={profile.official_name}
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>

                    {/* Name and Role - Positioned on banner */}
                    <div className="flex-1 pointer-events-auto text-center md:text-left mt-8 md:mt-0">
                        <div className="flex flex-col md:flex-row md:items-baseline md:gap-3">
                            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 md:text-white drop-shadow-lg">{profile.official_name}</h1>
                            <p className="text-sm md:text-base text-gray-600 md:text-white/90 drop-shadow-md mt-1 md:mt-0">{getRoleDisplay(profile.bonuses_role)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8 mt-12 md:mt-16">
                <div>
                    <div className="flex items-center justify-between mb-6 md:mb-8">
                        <h2 className="text-xl md:text-2xl font-bold text-gray-800">About</h2>
                    </div>

                        {/* About Content - 2 Columns on Desktop */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-16">
                            {/* Left Column: Work & Education */}
                            <div className="space-y-4 md:space-y-6">
                                <h3 className="text-xs md:text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 md:mb-4">Work & Education</h3>
                                {/* Role */}
                                <div className="flex items-start gap-3 md:gap-4">
                                    <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                        <BriefcaseIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        <p className="text-sm md:text-base text-gray-900 font-medium">
                                            {getRoleDisplay(profile.bonuses_role)} at <span className="font-bold">Decker, Pex, Levi</span>
                                        </p>
                                        <p className="text-xs md:text-sm text-gray-500">{profile.department_name} Department</p>
                                    </div>
                                </div>

                                {/* School */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                        <AcademicCapIcon className="w-5 h-5 text-black" />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        {profile.school ? (
                                            <p className="text-gray-900 font-medium">Studied at <span className="font-bold">{profile.school}</span></p>
                                        ) : (
                                            <p className="text-gray-400 italic">No school added</p>
                                        )}
                                    </div>
                                </div>

                                {/* Diploma */}
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                        <BuildingOfficeIcon className="w-5 h-5 text-black" />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        {profile.diplom ? (
                                            <p className="text-gray-900 font-medium">Holds a <span className="font-bold">{profile.diplom}</span></p>
                                        ) : (
                                            <p className="text-gray-400 italic">No diplom added</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Contact Info */}
                            <div className="space-y-4 md:space-y-6">
                                <h3 className="text-xs md:text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 md:mb-4">Contact Information</h3>

                                {/* Contact Info - Single column with more width */}
                                <div className="space-y-4 md:space-y-6 max-w-2xl">
                                    {/* Email */}
                                    {profile.email && (
                                        <div className="flex items-start gap-3 md:gap-4">
                                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                                <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                            </div>
                                            <div className="flex-1 pt-1">
                                                <a href={`mailto:${profile.email}`} className="text-sm md:text-base text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors break-all">
                                                    {profile.email}
                                                </a>
                                                <p className="text-xs md:text-sm text-gray-500">Email</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Mobile */}
                                    {profile.mobile && (
                                        <div className="flex items-start gap-3 md:gap-4">
                                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                                <DevicePhoneMobileIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                            </div>
                                            <div className="flex-1 pt-1">
                                                <a href={`tel:${profile.mobile}`} className="text-sm md:text-base text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors">
                                                    {profile.mobile}
                                                </a>
                                                <p className="text-xs md:text-sm text-gray-500">Mobile</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Phone */}
                                    {profile.phone && (
                                        <div className="flex items-start gap-3 md:gap-4">
                                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                                <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                            </div>
                                            <div className="flex-1 pt-1">
                                                <div className="text-sm md:text-base text-gray-900 font-medium">
                                                    <a href={`tel:${profile.phone}`} className="hover:text-blue-600 hover:underline transition-colors">
                                                        {profile.phone}
                                                    </a>
                                                    {profile.phone_ext && <span className="text-gray-400 font-normal ml-2">Ext: {profile.phone_ext}</span>}
                                                </div>
                                                <p className="text-xs md:text-sm text-gray-500">Office Phone</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* LinkedIn URL */}
                                    {profile.linkedin_url && (
                                        <div className="flex items-start gap-3 md:gap-4">
                                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                                <FaLinkedin className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                            </div>
                                            <div className="flex-1 pt-1">
                                                <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm md:text-base text-blue-600 hover:underline font-medium break-all">
                                                    {profile.linkedin_url}
                                                </a>
                                                <p className="text-xs md:text-sm text-gray-500">LinkedIn</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
            </div>

            {/* Footer */}
            <footer className="bg-white border-t border-gray-200 mt-16 md:mt-24">
                <div className="max-w-5xl mx-auto px-4 py-16 md:py-20 md:px-8">
                    <div className="flex flex-col items-center justify-center gap-8">
                        {/* Company Info & Addresses */}
                        <div className="text-center space-y-3">
                            <div className="flex items-center justify-center gap-3">
                                <img src="/DPL-LOGO1.png" alt="DPL Logo" className="h-12 w-auto object-contain" />
                                <p className="font-bold text-xl text-gray-900">Decker, Pex, Levi Law Offices</p>
                            </div>
                            <div className="text-gray-500 text-sm flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3">
                                <p>Yad Harutzim 10, Jerusalem, Israel</p>
                                <span className="hidden md:inline text-gray-400">•</span>
                                <p>Menachem Begin Rd. 150, Tel Aviv, Israel</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-12 pt-8 border-t border-gray-100 text-center text-xs text-gray-400">
                        Copyright © {new Date().getFullYear()} - All right reserved
                    </div>
                </div>
            </footer>

            {/* Floating Contact Buttons (Right Side Center) */}
            <div className="fixed right-4 md:right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 md:gap-4 z-50">
                {/* Text: Contact Office in two rows (horizontal) */}
                <div className="flex flex-col items-center gap-0.5 mb-2">
                    <div className="text-black font-semibold text-sm md:text-base">
                        Contact
                    </div>
                    <div className="text-black font-semibold text-sm md:text-base">
                        Office
                    </div>
                </div>
                <a
                    href="https://wa.me/972552780162"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-circle btn-md md:btn-lg bg-green-500 text-white border-none hover:bg-green-600 shadow-lg hover:scale-110 transition-transform"
                    title="Chat on WhatsApp"
                >
                    <FaWhatsapp className="w-5 h-5 md:w-8 md:h-8" />
                </a>
                <a
                    href="mailto:office@lawoffice.org.il"
                    className="btn btn-circle btn-md md:btn-lg bg-blue-600 text-white border-none hover:bg-blue-700 shadow-lg hover:scale-110 transition-transform"
                    title="Send Email"
                >
                    <FaEnvelope className="w-5 h-5 md:w-8 md:h-8" />
                </a>
                <a
                    href="tel:+972503489649"
                    className="btn btn-circle btn-md md:btn-lg bg-purple-600 text-white border-none hover:bg-purple-700 shadow-lg hover:scale-110 transition-transform"
                    title="Call Office"
                >
                    <PhoneIcon className="w-5 h-5 md:w-8 md:h-8" />
                </a>
            </div>
        </div>
    );
};

export default PublicProfilePage;
