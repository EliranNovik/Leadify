import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import {
    PencilIcon,
    CameraIcon,
    CheckIcon,
    XMarkIcon,
    AcademicCapIcon,
    BuildingOfficeIcon,
    BriefcaseIcon,
    PhoneIcon,
    EnvelopeIcon,
    HashtagIcon,
    DevicePhoneMobileIcon,
    LinkIcon,
    ShareIcon
} from '@heroicons/react/24/outline';
import { FaLinkedin, FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import { toast } from 'react-hot-toast';

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
    email: string;
    department_name: string;
    bonuses_role: string;
    official_name: string;
    school?: string;
    diplom?: string;
    linkedin_url?: string;
}

const MyProfilePage: React.FC = () => {
    const { user } = useAuthContext();
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [profile, setProfile] = useState<EmployeeProfile | null>(null);
    const [activeTab, setActiveTab] = useState('About');

    // Edit form state
    const [formData, setFormData] = useState({
        mobile: '',
        phone: '',
        phone_ext: '',
        display_name: '',
        official_name: '',
        school: '',
        diplom: '',
        linkedin_url: ''
    });

    const fileInputRef = useRef<HTMLInputElement>(null);
    const bannerInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (user) {
            fetchProfile();
        }
    }, [user]);

    const fetchProfile = async () => {
        try {
            setLoading(true);

            // Adding school and diplom to the select query (assuming columns exist as per user request)
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select(`
          email,
          employee_id,
          tenants_employee!employee_id (
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
          )
        `)
                .eq('auth_id', user?.id)
                .single();

            if (userError) throw userError;

            if (userData && userData.tenants_employee) {
                const emp = userData.tenants_employee as any;

                // Convert school array to string for display (database stores as array)
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
                    email: userData.email,
                    department_name: emp.tenant_departement?.name || 'General',
                    bonuses_role: emp.bonuses_role || 'Employee',
                    official_name: emp.official_name || emp.display_name,
                    school: schoolValue,
                    diplom: emp.diplom || '',
                    linkedin_url: emp.linkedin_url || ''
                };

                setProfile(profileData);
                setFormData({
                    mobile: profileData.mobile,
                    phone: profileData.phone,
                    phone_ext: profileData.phone_ext,
                    display_name: profileData.display_name,
                    official_name: profileData.official_name,
                    school: profileData.school,
                    diplom: profileData.diplom,
                    linkedin_url: profileData.linkedin_url || ''
                });
            }
        } catch (error) {
            console.error('Error fetching profile:', error);
            // Don't toast error immediately as columns might not exist yet
            // toast.error('Failed to load profile'); 
        } finally {
            setLoading(false);
        }
    };

    const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
        if (!event.target.files || event.target.files.length === 0 || !profile) {
            return;
        }

        const bucketName = 'My-Profile';
        const file = event.target.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${profile.id}_${type}_${Math.random()}.${fileExt}`;
        const filePath = `${fileName}`;

        setUploading(true);

        try {
            const { data, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);

            const updateField = type === 'avatar' ? 'photo_url' : 'chat_background_image_url';

            const { error: dbError } = await supabase
                .from('tenants_employee')
                .update({ [updateField]: publicUrl })
                .eq('id', profile.id);

            if (dbError) throw dbError;

            setProfile(prev => prev ? ({ ...prev, [type === 'avatar' ? 'photo_url' : 'chat_background_image_url']: publicUrl }) : null);
            toast.success(`${type === 'avatar' ? 'Profile photo' : 'Cover image'} updated!`);

        } catch (error: any) {
            console.error('Error uploading image:', error);
            toast.error(`Failed to upload image: ${error.message || 'Unknown error'}`);
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        if (!profile) return;

        try {
            setUploading(true);

            // Convert school to array format (database expects character varying[])
            // If empty string, set to null; otherwise convert to array
            const schoolValue = formData.school?.trim()
                ? [formData.school.trim()]
                : null;

            const { error } = await supabase
                .from('tenants_employee')
                .update({
                    mobile: formData.mobile,
                    phone: formData.phone,
                    phone_ext: formData.phone_ext,
                    school: schoolValue,
                    diplom: formData.diplom || null,
                    linkedin_url: formData.linkedin_url || null
                })
                .eq('id', profile.id);

            if (error) throw error;

            setProfile(prev => prev ? ({ ...prev, ...formData }) : null);
            setIsEditing(false);
            toast.success('Profile updated successfully');
        } catch (error) {
            console.error('Error updating profile:', error);
            toast.error('Failed to update profile');
        } finally {
            setUploading(false);
        }
    };

    const handleLinkedInSync = async () => {
        // Mock LinkedIn Sync
        toast.promise(
            new Promise((resolve) => setTimeout(resolve, 2000)),
            {
                loading: 'Syncing with LinkedIn...',
                success: 'Synced successfully!',
                error: 'Could not sync.',
            }
        );
        // Here you would implement real OAuth or scraping logic
    };

    const handleShare = async () => {
        if (!profile) return;

        try {
            const linkPath = `my-profile/${profile.id}`;
            const fullUrl = `${window.location.origin}/${linkPath}`;
            const linkText = `${profile.official_name} Decker, Pex, Levi Law Offices`;

            // Save the link to the database
            const { error: updateError } = await supabase
                .from('tenants_employee')
                .update({ open_link: linkPath })
                .eq('id', profile.id);

            if (updateError) throw updateError;

            // Copy just the URL - the Open Graph tags will handle the preview
            await navigator.clipboard.writeText(fullUrl);
            toast.success('Profile link copied to clipboard!');
        } catch (error) {
            console.error('Error sharing profile:', error);
            toast.error('Failed to generate share link');
        }
    };

    const handleShareBusinessCard = async () => {
        if (!profile) return;

        try {
            const businessCardUrl = `${window.location.origin}/business-card/${profile.id}`;
            await navigator.clipboard.writeText(businessCardUrl);
            toast.success('Business card link copied to clipboard!');
        } catch (error) {
            console.error('Error sharing business card:', error);
            toast.error('Failed to copy business card link');
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

                {/* Edit Profile and Share Buttons - TOP RIGHT of banner */}
                <div className="absolute top-4 right-4 flex items-center gap-2">
                    {!isEditing && (
                        <>
                            <button
                                onClick={handleShare}
                                className="btn btn-sm btn-ghost bg-black/40 text-white hover:bg-black/60 backdrop-blur-md border-0 gap-2"
                                title="Share Profile"
                            >
                                <ShareIcon className="w-4 h-4" />
                                Share
                            </button>
                            <button
                                onClick={handleShareBusinessCard}
                                className="btn btn-sm btn-ghost bg-black/40 text-white hover:bg-black/60 backdrop-blur-md border-0 gap-2"
                                title="Share Business Card"
                            >
                                <ShareIcon className="w-4 h-4" />
                                Share Card
                            </button>
                            <button
                                onClick={() => setIsEditing(true)}
                                className="btn btn-sm btn-ghost bg-black/40 text-white hover:bg-black/60 backdrop-blur-md border-0 gap-2"
                            >
                                <PencilIcon className="w-4 h-4" />
                                Edit Profile
                            </button>
                        </>
                    )}
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
                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <CameraIcon className="w-6 h-6 md:w-8 md:h-8 text-white" />
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={(e) => handleImageUpload(e, 'avatar')}
                            className="hidden"
                            accept="image/*"
                        />
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

            {/* Navigation Tabs (Floating Glassy Badges) - Right below banner */}
            <div className="px-4 md:px-8 max-w-5xl mx-auto -mt-6">
                <div className="flex gap-2 md:gap-4 overflow-x-auto pb-2">
                    {['About', 'Working Hours', 'Contribution', 'Documents'].map((tab) => (
                        <button
                            key={tab}
                            className={`px-4 md:px-6 py-2 rounded-full text-sm font-semibold transition-all backdrop-blur-md border whitespace-nowrap ${activeTab === tab
                                ? 'bg-black/60 text-white shadow-lg border-black/40'
                                : 'bg-black/30 text-white hover:bg-black/50 border-black/20'
                                }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8 mt-12 md:mt-16">
                {activeTab === 'About' && (
                    <div>
                        <div className="flex items-center justify-between mb-6 md:mb-8">
                            <h2 className="text-xl md:text-2xl font-bold text-gray-800">About</h2>
                        </div>

                        {/* About Content - 2 Columns on Desktop */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-16">
                            {/* Usage of grid-cols-2 makes it two columns. Added larger gap for separation. */}

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
                                    <div className="flex items-start gap-3 md:gap-4">
                                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                            <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                        </div>
                                        <div className="flex-1 pt-1">
                                            <p className="text-sm md:text-base text-gray-900 font-medium break-all">{profile.email}</p>
                                            <p className="text-xs md:text-sm text-gray-500">Email</p>
                                        </div>
                                    </div>

                                    {/* Mobile */}
                                    <div className="flex items-start gap-3 md:gap-4">
                                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                            <DevicePhoneMobileIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                        </div>
                                        <div className="flex-1 pt-1">
                                            {profile.mobile ? (
                                                <a href={`tel:${profile.mobile}`} className="text-sm md:text-base text-gray-900 font-medium hover:text-blue-600 hover:underline transition-colors">
                                                    {profile.mobile}
                                                </a>
                                            ) : (
                                                <p className="text-gray-400 italic text-sm md:text-base">Not set</p>
                                            )}
                                            <p className="text-xs md:text-sm text-gray-500">Mobile</p>
                                        </div>
                                    </div>

                                    {/* Phone */}
                                    <div className="flex items-start gap-3 md:gap-4">
                                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                            <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                        </div>
                                        <div className="flex-1 pt-1">
                                            {profile.phone ? (
                                                <div className="text-sm md:text-base text-gray-900 font-medium">
                                                    <a href={`tel:${profile.phone}`} className="hover:text-blue-600 hover:underline transition-colors">
                                                        {profile.phone}
                                                    </a>
                                                    {profile.phone_ext && <span className="text-gray-400 font-normal ml-2">Ext: {profile.phone_ext}</span>}
                                                </div>
                                            ) : (
                                                <p className="text-gray-400 italic text-sm md:text-base">Not set</p>
                                            )}
                                            <p className="text-xs md:text-sm text-gray-500">Office Phone</p>
                                        </div>
                                    </div>

                                    {/* LinkedIn URL */}
                                    <div className="flex items-start gap-3 md:gap-4">
                                        <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 border border-gray-100">
                                            <FaLinkedin className="w-4 h-4 md:w-5 md:h-5 text-black" />
                                        </div>
                                        <div className="flex-1 pt-1">
                                            {profile.linkedin_url ? (
                                                <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm md:text-base text-blue-600 hover:underline font-medium">
                                                    View linkedin profile
                                                </a>
                                            ) : (
                                                <p className="text-gray-400 italic text-sm md:text-base">No LinkedIn profile</p>
                                            )}
                                            <p className="text-xs md:text-sm text-gray-500">LinkedIn</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* Other tabs placeholders */}
                {activeTab !== 'About' && (
                    <div className="py-20 text-center text-gray-400">
                        <HashtagIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                        <p>This tab is a placeholder for visual demonstration.</p>
                    </div>
                )}
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


                        {/* Contact Us Section - Removed as per request (moved to floating) */}
                    </div>

                    <div className="mt-12 pt-8 border-t border-gray-100 text-center text-xs text-gray-400">
                        RMQ 2.0 - Copyright © {new Date().getFullYear()} - All right reserved
                    </div>
                </div>
            </footer>

            {/* Floating Contact Buttons (Right Side Center) */}
            <div className="fixed right-4 md:right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 md:gap-4 z-50">
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

                {/* Cancel and Save Buttons - Only visible when editing */}
                {isEditing && (
                    <div className="flex flex-col gap-3 md:gap-4 mt-2">
                        <button
                            onClick={() => {
                                setIsEditing(false);
                                setFormData({
                                    mobile: profile.mobile,
                                    phone: profile.phone,
                                    phone_ext: profile.phone_ext,
                                    display_name: profile.display_name,
                                    official_name: profile.official_name,
                                    school: profile.school || '',
                                    diplom: profile.diplom || '',
                                    linkedin_url: profile.linkedin_url || ''
                                });
                            }}
                            className="btn btn-circle btn-md md:btn-lg bg-red-500 text-white border-none hover:bg-red-600 shadow-lg hover:scale-110 transition-transform"
                            disabled={uploading}
                            title="Cancel"
                        >
                            <XMarkIcon className="w-5 h-5 md:w-8 md:h-8" />
                        </button>
                        <button
                            onClick={handleSave}
                            className="btn btn-circle btn-md md:btn-lg bg-green-500 text-white border-none hover:bg-green-600 shadow-lg hover:scale-110 transition-transform"
                            disabled={uploading}
                            title="Save"
                        >
                            <CheckIcon className="w-5 h-5 md:w-8 md:h-8" />
                        </button>
                    </div>
                )}
            </div>

            {/* Edit Profile Modal */}
            {isEditing && typeof window !== 'undefined' && createPortal(
                <div
                    className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isEditing ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                    onClick={() => {
                        setIsEditing(false);
                        setFormData({
                            mobile: profile.mobile,
                            phone: profile.phone,
                            phone_ext: profile.phone_ext,
                            display_name: profile.display_name,
                            official_name: profile.official_name,
                            school: profile.school || '',
                            diplom: profile.diplom || '',
                            linkedin_url: profile.linkedin_url || ''
                        });
                    }}
                >
                    <div
                        className={`bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 transform transition-all duration-300 ${isEditing ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                            <h2 className="text-2xl font-bold text-gray-900">Edit Profile</h2>
                            <button
                                onClick={() => {
                                    setIsEditing(false);
                                    setFormData({
                                        mobile: profile.mobile,
                                        phone: profile.phone,
                                        phone_ext: profile.phone_ext,
                                        display_name: profile.display_name,
                                        official_name: profile.official_name,
                                        school: profile.school || '',
                                        diplom: profile.diplom || '',
                                        linkedin_url: profile.linkedin_url || ''
                                    });
                                }}
                                className="btn btn-ghost btn-sm btn-circle"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 space-y-6">
                            {/* Work & Education Section */}
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Work & Education</h3>
                                <div className="space-y-4">
                                    {/* School */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            School
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="Add a school"
                                            value={formData.school}
                                            onChange={(e) => setFormData({ ...formData, school: e.target.value })}
                                        />
                                    </div>

                                    {/* Diploma */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Diploma
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="Add a diplom"
                                            value={formData.diplom}
                                            onChange={(e) => setFormData({ ...formData, diplom: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Contact Information Section */}
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Contact Information</h3>
                                <div className="space-y-4">
                                    {/* Mobile */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Mobile
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="Mobile number"
                                            value={formData.mobile}
                                            onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                                        />
                                    </div>

                                    {/* Phone */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Office Phone
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                className="input input-bordered flex-1"
                                                placeholder="Office Phone"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            />
                                            <input
                                                type="text"
                                                className="input input-bordered w-24"
                                                placeholder="Ext"
                                                value={formData.phone_ext}
                                                onChange={(e) => setFormData({ ...formData, phone_ext: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    {/* LinkedIn */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            LinkedIn URL
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="https://linkedin.com/in/..."
                                            value={formData.linkedin_url}
                                            onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer with Cancel and Save Buttons */}
                        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
                            <button
                                onClick={() => {
                                    setIsEditing(false);
                                    setFormData({
                                        mobile: profile.mobile,
                                        phone: profile.phone,
                                        phone_ext: profile.phone_ext,
                                        display_name: profile.display_name,
                                        official_name: profile.official_name,
                                        school: profile.school || '',
                                        diplom: profile.diplom || '',
                                        linkedin_url: profile.linkedin_url || ''
                                    });
                                }}
                                className="btn btn-ghost"
                                disabled={uploading}
                            >
                                <XMarkIcon className="w-5 h-5 mr-2" />
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="btn btn-primary"
                                disabled={uploading}
                            >
                                <CheckIcon className="w-5 h-5 mr-2" />
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default MyProfilePage;

