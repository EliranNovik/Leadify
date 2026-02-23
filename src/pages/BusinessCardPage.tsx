import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
    EnvelopeIcon,
    PhoneIcon,
    DevicePhoneMobileIcon,
    ArrowsRightLeftIcon,
} from '@heroicons/react/24/solid';
import { FaWhatsapp, FaEnvelope, FaLinkedin } from 'react-icons/fa';

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
    linkedin_url?: string | null;
}

const BusinessCardPage: React.FC = () => {
    const { employeeId: employeeIdParam } = useParams<{ employeeId: string }>();
    // Handle URL encoding and extract employeeId from pathname as fallback
    const [employeeId, setEmployeeId] = useState<string | undefined>(employeeIdParam);
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<EmployeeProfile | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Trigger animation after component mounts
        const timer = setTimeout(() => {
            setIsVisible(true);
        }, 50);
        return () => clearTimeout(timer);
    }, []);

    // Extract employeeId from URL pathname as fallback (for mobile routing issues)
    useEffect(() => {
        if (!employeeIdParam) {
            // Try to extract from pathname as fallback
            const pathname = window.location.pathname;
            const match = pathname.match(/\/business-card\/([^\/]+)/);
            if (match && match[1]) {
                const extractedId = decodeURIComponent(match[1]);
                setEmployeeId(extractedId);
            }
        } else {
            setEmployeeId(employeeIdParam);
        }
    }, [employeeIdParam]);

    useEffect(() => {
        if (employeeId) {
            fetchProfile();
        } else {
            setLoading(false);
        }
    }, [employeeId]);

    const fetchProfile = async () => {
        try {
            setLoading(true);

            // Validate employeeId
            if (!employeeId) {
                console.error('BusinessCardPage: employeeId is undefined');
                setLoading(false);
                return;
            }

            const parsedId = parseInt(employeeId, 10);
            if (isNaN(parsedId) || parsedId <= 0) {
                console.error('BusinessCardPage: Invalid employeeId:', employeeId);
                setLoading(false);
                return;
            }

            console.log('BusinessCardPage: Fetching profile for employeeId:', parsedId);

            // Try simple query first (works better with RLS policies)
            let { data: employeeData, error: employeeError } = await supabase
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
                    linkedin_url,
                    department_id
                `)
                .eq('id', parsedId)
                .maybeSingle();

            // If simple query has error (not just no data), try with join
            if (employeeError && employeeError.code !== 'PGRST116') {
                console.warn('BusinessCardPage: Simple query error, trying with join:', employeeError);

                const { data: joinData, error: joinError } = await supabase
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
                        linkedin_url,
                        department_id,
                        tenant_departement!department_id (
                            name
                        )
                    `)
                    .eq('id', parsedId)
                    .maybeSingle();

                if (joinError && joinError.code !== 'PGRST116') {
                    console.error('BusinessCardPage: Both queries failed. Simple error:', employeeError, 'Join error:', joinError);
                    // Don't throw, just set loading to false and let it show "Profile Not Found"
                    setLoading(false);
                    return;
                }

                if (joinData) {
                    employeeData = joinData;
                }
            }

            if (!employeeData) {
                console.error('BusinessCardPage: No employee found with id:', parsedId);
                setLoading(false);
                return;
            }

            const emp = employeeData as any;

            // Fetch department name separately if join didn't work
            let departmentName = 'General';
            if (emp.tenant_departement?.name) {
                departmentName = emp.tenant_departement.name;
            } else if (emp.department_id) {
                const { data: deptData } = await supabase
                    .from('tenant_departement')
                    .select('name')
                    .eq('id', emp.department_id)
                    .maybeSingle();
                if (deptData?.name) {
                    departmentName = deptData.name;
                }
            }

            // Fetch email from users table
            let email = null;
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('email')
                .eq('employee_id', emp.id)
                .maybeSingle();

            if (userError) {
                console.warn('BusinessCardPage: Error fetching user email:', userError);
            } else if (userData) {
                email = userData.email;
            }

            const profileData = {
                id: emp.id,
                display_name: emp.display_name,
                photo_url: emp.photo_url,
                chat_background_image_url: emp.chat_background_image_url,
                mobile: emp.mobile || '',
                phone: emp.phone || '',
                phone_ext: emp.phone_ext || '',
                email: email,
                department_name: departmentName,
                bonuses_role: emp.bonuses_role || 'Employee',
                official_name: emp.official_name || emp.display_name,
                linkedin_url: emp.linkedin_url || null,
            };

            console.log('BusinessCardPage: Profile loaded successfully:', profileData.display_name);
            setProfile(profileData);
        } catch (error) {
            console.error('BusinessCardPage: Error fetching profile:', error);
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
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-2 md:p-4">
            {/* Mobile Contact Buttons - Top Horizontal */}
            <div className="md:hidden fixed top-4 left-1/2 -translate-x-1/2 flex gap-3 z-50">
                <a
                    href="https://wa.me/972552780162"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-circle btn-sm bg-green-500 text-white border-none hover:bg-green-600 shadow-lg hover:scale-110 transition-transform"
                    title="Chat on WhatsApp"
                >
                    <FaWhatsapp className="w-4 h-4" />
                </a>
                <a
                    href="mailto:office@lawoffice.org.il"
                    className="btn btn-circle btn-sm bg-blue-600 text-white border-none hover:bg-blue-700 shadow-lg hover:scale-110 transition-transform"
                    title="Send Email"
                >
                    <FaEnvelope className="w-4 h-4" />
                </a>
                <a
                    href="tel:+972503489649"
                    className="btn btn-circle btn-sm bg-purple-600 text-white border-none hover:bg-purple-700 shadow-lg hover:scale-110 transition-transform"
                    title="Call Office"
                >
                    <PhoneIcon className="w-4 h-4" />
                </a>
            </div>

            {/* Turn Card Button - Top Right */}
            <button
                onClick={() => setIsFlipped(!isFlipped)}
                className="fixed top-4 right-4 md:top-6 md:right-6 z-50 btn btn-sm bg-black/60 text-white border-none hover:bg-black/80 backdrop-blur-md shadow-lg flex items-center gap-2"
            >
                Turn card
                <ArrowsRightLeftIcon className="w-4 h-4" />
            </button>

            {/* Card Flip Container */}
            <div
                className={`relative w-full md:w-[1200px] md:h-[630px] min-h-[600px] md:min-h-[630px] transition-all duration-700 ease-out ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                    }`}
                style={{
                    maxWidth: '100%',
                    maxHeight: '100vh',
                    perspective: '1000px',
                    animation: isVisible && !isFlipped ? 'cardTilt 3s ease-in-out' : 'none',
                }}
            >
                <div
                    ref={cardRef}
                    className="relative w-full h-full"
                    style={{
                        transformStyle: 'preserve-3d',
                        transition: 'transform 0.8s ease-in-out',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                    }}
                >
                    {/* Front Side of Card */}
                    <div
                        className="absolute inset-0 w-full h-full bg-white overflow-hidden rounded-2xl"
                        style={{
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'rotateY(0deg)',
                            boxShadow: isVisible
                                ? '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 10px 30px -5px rgba(0, 0, 0, 0.3), 0 0 60px -15px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                                : '0 0 0 rgba(0, 0, 0, 0)',
                        }}
                    >
                        <style>{`
                @keyframes cardTilt {
                    0% {
                        transform: perspective(1000px) rotateX(0deg) rotateY(0deg);
                    }
                    25% {
                        transform: perspective(1000px) rotateX(0deg) rotateY(-2deg);
                    }
                    50% {
                        transform: perspective(1000px) rotateX(0deg) rotateY(2deg);
                    }
                    75% {
                        transform: perspective(1000px) rotateX(0deg) rotateY(-1deg);
                    }
                    100% {
                        transform: perspective(1000px) rotateX(0deg) rotateY(0deg);
                    }
                }
            `}</style>
                        {/* Background Image with Overlay */}
                        <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{
                                backgroundImage: `url(${profile.chat_background_image_url || DEFAULT_BANNER})`,
                            }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60"></div>
                        </div>

                        {/* Logo - Top Left */}
                        <div className="absolute top-3 left-3 md:top-6 md:left-6 z-10">
                            <img
                                src="/DPLOGO1.png"
                                alt="DPL Logo"
                                className="h-8 md:h-14 drop-shadow-2xl"
                            />
                        </div>

                        {/* Centered Content Container */}
                        <div className="relative z-10 h-full flex items-center justify-center px-4 py-8 md:px-16 md:py-12 min-h-[600px] md:min-h-[630px]">
                            <div className="text-center text-white max-w-3xl w-full -mt-8 md:-mt-12">
                                {/* Profile Image - Centered above name */}
                                <div className="flex justify-center mb-4 md:mb-6">
                                    <div className="w-24 h-24 md:w-40 md:h-40 rounded-full shadow-2xl overflow-hidden">
                                        <img
                                            src={profile.photo_url || DEFAULT_AVATAR}
                                            alt={profile.official_name}
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                </div>

                                {/* Name */}
                                <h1 className="text-3xl md:text-6xl font-bold mb-2 md:mb-3 drop-shadow-2xl tracking-tight px-2">
                                    {profile.official_name}
                                </h1>

                                {/* Department */}
                                <p className="text-base md:text-2xl text-white/95 mb-3 md:mb-4 drop-shadow-lg font-medium px-2">
                                    {profile.department_name} Department
                                </p>

                                {/* Company Name */}
                                <p className="text-sm md:text-xl text-white/90 mb-6 md:mb-8 drop-shadow-md font-semibold px-2">
                                    Decker, Pex, Levi Law Offices
                                </p>

                                {/* Contact Information - Vertical on mobile, horizontal on desktop */}
                                <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-6 mt-6 md:mt-8 px-2">
                                    {profile.email && (
                                        <a
                                            href={`mailto:${profile.email}`}
                                            className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-4 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                                        >
                                            <EnvelopeIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                                            <span className="text-sm md:text-base font-medium break-all">{profile.email}</span>
                                        </a>
                                    )}
                                    {profile.mobile && (
                                        <a
                                            href={`tel:${profile.mobile}`}
                                            className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-4 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                                        >
                                            <DevicePhoneMobileIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                                            <span className="text-sm md:text-base font-medium">{profile.mobile}</span>
                                        </a>
                                    )}
                                    {profile.phone && (
                                        <a
                                            href={`tel:${profile.phone}`}
                                            className="flex items-center gap-2 md:gap-3 bg-white/10 backdrop-blur-md px-4 py-2 md:px-5 md:py-2.5 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full md:w-auto justify-center"
                                        >
                                            <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 text-white flex-shrink-0" />
                                            <span className="text-sm md:text-base font-medium">
                                                {profile.phone}
                                                {profile.phone_ext && <span className="ml-2 text-white/80">Ext: {profile.phone_ext}</span>}
                                            </span>
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Addresses - Bottom - Stack on mobile */}
                        <div className="absolute bottom-3 md:bottom-6 left-0 right-0 z-10 px-3 md:px-0">
                            <div className="flex flex-col md:flex-row items-center justify-center gap-2 md:gap-6 text-white/90 text-xs md:text-sm drop-shadow-md">
                                <span className="text-center">Yad Harutzim 10, Jerusalem, Israel</span>
                                <span className="hidden md:inline text-white/60">•</span>
                                <span className="text-center">Menachem Begin Rd. 150, Tel Aviv, Israel</span>
                            </div>
                        </div>
                    </div>

                    {/* Back Side of Card */}
                    <div
                        className="absolute inset-0 w-full h-full bg-white overflow-hidden rounded-2xl"
                        style={{
                            backfaceVisibility: 'hidden',
                            WebkitBackfaceVisibility: 'hidden',
                            transform: 'rotateY(180deg)',
                            boxShadow: isVisible
                                ? '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.1), 0 10px 30px -5px rgba(0, 0, 0, 0.3), 0 0 60px -15px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                                : '0 0 0 rgba(0, 0, 0, 0)',
                        }}
                    >
                        {/* Background Image with Overlay */}
                        <div
                            className="absolute inset-0 bg-cover bg-center"
                            style={{
                                backgroundImage: `url(${profile.chat_background_image_url || DEFAULT_BANNER})`,
                            }}
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60"></div>
                        </div>

                        {/* Company Name - Top Centered */}
                        <div className="absolute top-6 md:top-8 left-0 right-0 z-10">
                            <h2 className="text-xl md:text-2xl font-bold text-white text-center drop-shadow-2xl">
                                Decker Pex Levi Law Offices
                            </h2>
                        </div>

                        {/* Addresses Content - Centered (Only addresses, no other front content) */}
                        <div className="relative z-10 h-full flex items-center justify-center px-4 py-8 md:px-16 md:py-12 min-h-[600px] md:min-h-[630px]">
                            <div className="text-center text-white max-w-5xl w-full">
                                <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16">
                                    {/* Tel Aviv Office */}
                                    <div className="flex-1">
                                        <h2 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6 drop-shadow-2xl">
                                            Tel Aviv Office
                                        </h2>
                                        <div className="text-base md:text-lg text-white/95 drop-shadow-lg space-y-2">
                                            <p className="font-semibold">WE Tower TLV</p>
                                            <p>150 Begin Rd., 8th floor</p>
                                            <p>Tel Aviv 6492105, Israel</p>
                                        </div>
                                    </div>

                                    {/* Jerusalem Office */}
                                    <div className="flex-1">
                                        <h2 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6 drop-shadow-2xl">
                                            Jerusalem Office
                                        </h2>
                                        <div className="text-base md:text-lg text-white/95 drop-shadow-lg space-y-2">
                                            <p className="font-semibold">Yad Harutzim st 10</p>
                                            <p>5th floor Jerusalem</p>
                                            <p>Jerusalem 9342148, Israel</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Email and Website - Bottom */}
                        <div className="absolute bottom-4 md:bottom-6 left-0 right-0 z-10">
                            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 text-white/95 text-sm md:text-base drop-shadow-md px-4">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold">Email:</span>
                                    <a href="mailto:office@lawoffice.org.il" className="hover:text-white hover:underline transition-colors">
                                        office@lawoffice.org.il
                                    </a>
                                </div>
                                <span className="hidden md:inline text-white/60">•</span>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold">Website:</span>
                                    <a href="https://www.lawoffice.org.il" target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline transition-colors">
                                        www.lawoffice.org.il
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating Contact Buttons (Right Side Center) - Hidden on mobile */}
            <div className="hidden md:flex fixed right-4 md:right-6 top-1/2 -translate-y-1/2 flex-col gap-3 md:gap-4 z-50">
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
                {profile?.linkedin_url && (
                    <a
                        href={profile.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-circle btn-md md:btn-lg bg-blue-700 text-white border-none hover:bg-blue-800 shadow-lg hover:scale-110 transition-transform"
                        title="View LinkedIn Profile"
                    >
                        <FaLinkedin className="w-5 h-5 md:w-8 md:h-8" />
                    </a>
                )}
            </div>
        </div>
    );
};

export default BusinessCardPage;
