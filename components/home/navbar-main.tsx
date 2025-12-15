"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { X, Menu, LayoutGrid } from "lucide-react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ButtonNavbar from "./button-navbar";
import { useDisableScroll } from "@/hooks/use-disable-scroll";
import { cn } from "@/lib/utils";

// Types
interface DropdownItem {
    title: string;
    description: string;
    path: string;
    category?: string;
}

interface MenuItem {
    name: string;
    hasDropdown: boolean;
    dropdownType?: string;
    overview?: {
        title: string;
        description: string;
        path: string;
        icon?: string;
    };
    dropdownItems?: DropdownItem[];
    path?: string;
}

interface NavbarConfig {
    logo: {
        src: string;
        alt: string;
        width: number;
        height: number;
    };
    menuItems: MenuItem[];
    ctaButton: {
        text: string;
        link: string;
        variant: 'primary' | 'secondary' | 'outline';
    };
}

// Static navbar configuration
const navbarConfig: NavbarConfig = {
    logo: {
        src: "/tools/shadow-it-scan/full-logo-stitchflow.webp",
        alt: "Stitchflow",
        width: 120,
        height: 28,
    },
    menuItems: [
        {
            name: "Resources",
            hasDropdown: true,
            dropdownType: "one-column",
            dropdownItems: [
                {
                    title: "Blog",
                    description: "Insights, trends, and best practices in modern IT.",
                    path: "https://www.stitchflow.com/blog"
                },
                {
                    title: "Case Studies",
                    description: "Real-world success stories from Stitchflow customers",
                    path: "https://www.stitchflow.com/case-studies"
                },
                {
                    title: "Whitepapers",
                    description: "Deep dives into our security and automation resilience.",
                    path: "https://www.stitchflow.com/whitepapers"
                },
                {
                    title: "Stitchflow Savings Calculator",
                    description: "Get a tailored ROI snapshot of how Stitchflow pays for itself.",
                    path: "https://www.stitchflow.com/tools/roi-calculator"
                }
            ]
        },
        {
            name: "Free Tools",
            hasDropdown: false,
            path: "https://www.stitchflow.com/tools"
        },
        {
            name: "Company",
            hasDropdown: true,
            dropdownType: "one-column",
            dropdownItems: [
                {
                    title: "About Us",
                    description: "Meet the team behind Stitchflow.",
                    path: "https://www.stitchflow.com/about"
                },
                {
                    title: "Security",
                    description: "How Stitchflow keeps your data safe and compliant",
                    path: "https://www.stitchflow.com/security"
                }
            ]
        }
    ],
    ctaButton: {
        text: "Book demo",
        link: "https://www.stitchflow.com/demo",
        variant: "primary"
    }
};

// Dropdown Content Component
const DropdownContent = ({ item, toggleDropdown, setIsOpen }: { item: MenuItem, toggleDropdown: (index: number | null) => void, setIsOpen: () => void }) => {
    const router = useRouter();

    const handleClick = (path: string) => {
        router.push(path);
        toggleDropdown(null);
        setIsOpen();
    };

    if (item.dropdownType === 'two-column' && item.dropdownItems) {
        // Group items by category
        const categories = item.dropdownItems.reduce((acc, dropdownItem) => {
            const category = dropdownItem.category || 'Other';
            if (!acc[category]) acc[category] = [];
            acc[category].push(dropdownItem);
            return acc;
        }, {} as Record<string, DropdownItem[]>);

        return (
            <div className="w-full lg:w-[690px] pt-1  md:pt-3">
                <div className="rounded-2xl border border-gray-200 shadow-[0_2px_6px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.08)] p-5 bg-white space-y-4 relative z-[60]">
                    {/* Top Section */}
                    {item.overview && (
                        <div onClick={() => handleClick(item.overview!.path)} className="bg-[#F8F5F3] border border-[#f3e8e1] cursor-pointer rounded-lg p-4 flex items-start gap-3">
                            <div className="bg-[#efe5df] p-2 rounded-md">
                                <span className="text-gray-600 text-xl"><LayoutGrid /></span>
                            </div>
                            <div>
                                <div className="text-gray-800 font-semibold">{item.overview.title}</div>
                                <p className="text-sm text-gray-700">{item.overview.description}</p>
                            </div>
                        </div>
                    )}
                    <span className="border-b border-gray-200 pb-2 block w-full"></span>

                    {/* Main Sections */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.entries(categories).map(([category, items]) => (
                            <div key={category}>
                                <div className="text-gray-500 font-semibold uppercase tracking-wide mb-2 text-sm cursor-default">
                                    {category}
                                </div>
                                <ul>
                                    {items.map((dropdownItem, index) => (
                                        <li
                                            key={index}
                                            onClick={() => handleClick(dropdownItem.path)}
                                            className="cursor-pointer hover:bg-[#F8F5F3] p-2 rounded-lg"
                                        >
                                            <p className="font-semibold text-sm text-gray-800">{dropdownItem.title}</p>
                                            <p className="text-sm text-gray-500">{dropdownItem.description}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Default one-column dropdown
    return (
        <div className="w-full md:w-[500px] pt-1 md:pt-3">
            <div className="rounded-2xl border border-gray-200 shadow-[0_2px_6px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.08)] p-5 bg-white space-y-4 relative z-[60]">
                {item.dropdownItems?.map((dropdownItem, index) => (
                    <div
                        key={index}
                        onClick={() => handleClick(dropdownItem.path)}
                        className="cursor-pointer hover:bg-[#F8F5F3] p-2 rounded-lg"
                    >
                        <p className="font-semibold text-sm text-gray-800">{dropdownItem.title}</p>
                        <p className="text-sm text-gray-500">{dropdownItem.description}</p>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Desktop Navigation Component
const DesktopNavigation = ({
    menuItems,
    activeDropdown,
    toggleDropdown,
    ctaButton,
}: {
    menuItems: MenuItem[];
    activeDropdown: number | null;
    toggleDropdown: (index: number | null) => void;
    ctaButton: { text: string; link: string, variant: 'primary' | 'secondary' | 'outline' };
}) => {
    const router = useRouter();

    return (
        <nav role="navigation" className="hidden lg:flex justify-between w-full">
            <ul className="relative flex items-center lg:right-[35px] xl:right-0 lg:gap-6 xl:gap-6 lg:px-2 xl:px-0">
                {menuItems.map((item, index) => (
                    <li key={index} className="relative group">
                        {item.hasDropdown ? (
                            <>
                                <button
                                    onClick={() => toggleDropdown(index)}
                                    className="flex items-center gap-1 cursor-pointer font-medium text-[#363338] hover:text-gray-600 focus:outline-none py-2"
                                >
                                    {item.name}
                                    <svg
                                        className={`w-4 h-4 ml-1 transition-transform ${activeDropdown === index ? "rotate-180" : ""
                                            }`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M19 9l-7 7-7-7"
                                        />
                                    </svg>
                                </button>

                                <div
                                    className={`absolute top-full left-0 mt-2 transition-all duration-200 ease-in-out z-50 ${activeDropdown === index
                                        ? "opacity-100 visible translate-y-1"
                                        : "opacity-0 invisible -translate-y-1"
                                        }`}
                                >
                                    {item.dropdownItems && (
                                        <DropdownContent
                                            item={item}
                                            toggleDropdown={toggleDropdown}
                                            setIsOpen={() => toggleDropdown(null)}
                                        />
                                    )}
                                </div>
                            </>
                        ) : (
                            <Link
                                href={typeof item.path === "string" ? item.path : "#"}
                                onClick={() => toggleDropdown(null)}
                                className="font-medium text-[#363338] hover:text-gray-600 py-2 block"
                            >
                                {item.name}
                            </Link>
                        )}
                    </li>
                ))}
            </ul>

            <div className="relative hidden lg:flex justify-end items-center gap-3">
                <ButtonNavbar
                    variant={ctaButton.variant}
                    onClick={() => {
                        window.open(ctaButton.link, '_blank');
                        toggleDropdown(null);
                    }}
                    withArrow
                    arrowAnimation="click"
                >
                    {ctaButton.text}
                </ButtonNavbar>
            </div>
        </nav>
    );
};

// Mobile Navigation Component
const MobileNavigation = ({
    isOpen,
    menuItems,
    activeDropdown,
    toggleDropdown,
    ctaButton,
    setIsOpen,
    setActiveDropdown,
}: {
    isOpen: boolean;
    menuItems: MenuItem[];
    activeDropdown: number | null;
    toggleDropdown: (index: number | null) => void;
    ctaButton: { text: string; link: string; variant: 'primary' | 'secondary' | 'outline' };
    setIsOpen: (isOpen: boolean) => void;
    setActiveDropdown: (activeDropdown: number | null) => void;
}) => {
    const router = useRouter();

    const handleItemClick = (path?: string) => {
        if (path) {
            router.push(path);
        }
        setIsOpen(false);
        setActiveDropdown(null);
        toggleDropdown(null);
    };

    if (!isOpen) return null;

    return (
        <div className="w-full z-40 lg:hidden h-[100vh] bg-white">
            <div className="h-full pt-0 pb-36 pl-0.5 pr-2 overflow-y-auto bg-white">
                <div className="p-4 pb-10 space-y-6">
                    {menuItems.map((item, index) => (
                        <div key={index} className="space-y-4">
                            {item.hasDropdown ? (
                                <>
                                    <button
                                        onClick={() => toggleDropdown(index)}
                                        className="flex items-center justify-between w-full font-semibold text-lg"
                                    >
                                        {item.name}
                                        <svg
                                            className={`w-4 h-4 ml-1 transition-transform ${activeDropdown === index ? "rotate-180" : ""
                                                }`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M19 9l-7 7-7-7"
                                            />
                                        </svg>
                                    </button>
                                    {activeDropdown === index && item.dropdownItems && (
                                        <DropdownContent
                                            item={item}
                                            toggleDropdown={toggleDropdown}
                                            setIsOpen={() => setIsOpen(false)}
                                        />
                                    )}
                                </>
                            ) : (
                                <button
                                    onClick={() => handleItemClick(item.path)}
                                    className="flex items-center justify-between w-full font-semibold text-lg text-left"
                                >
                                    {item.name}
                                </button>
                            )}
                        </div>
                    ))}

                    <div className="flex border-y border-gray-100/75 flex-row gap-4 py-4 flex-wrap">
                        <ButtonNavbar
                            variant={ctaButton.variant}
                            onClick={() => {
                                window.open(ctaButton.link, '_blank');
                                setIsOpen(false);
                                setActiveDropdown(null);
                            }}
                            withArrow
                            arrowAnimation="click"
                        >
                            {ctaButton.text}
                        </ButtonNavbar>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Main Navbar Component
const NavbarMain = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isScrolled, setIsScrolled] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const headerRef = useRef<HTMLDivElement>(null);

    const { logo, menuItems, ctaButton } = navbarConfig;

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 0);
        };

        const handleClickOutside = (event: MouseEvent) => {
            if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
                setActiveDropdown(null);
            }
        };

        window.addEventListener("scroll", handleScroll);
        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            window.removeEventListener("scroll", handleScroll);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [pathname]);

    useDisableScroll(isOpen);

    const handleDropdownItemClick = (path: string) => {
        router.push(path);
        setActiveDropdown(null);
        setIsOpen(false);
    };

    const toggleDropdown = (index: number | null) => {
        setActiveDropdown(activeDropdown === index ? null : index);
    };

    return (
        <div className="fixed z-[999] top-0 inset-x-0 fixed-navbar">
            <div
                ref={headerRef}
                className={cn('z-[80] w-full transition-all duration-500 ease-in-out', {
                    'bg-[rgba(248,245,243,0.85)] backdrop-blur-[5px]': isScrolled,
                    'bg-[#F8F5F3]': !isScrolled && !isOpen,
                    'bg-[#ffffff]': isOpen,
                })}
            >
                <div className="relative w-full max-w-[1400px] flex items-center py-4 px-4 lg:px-8 mx-auto">
                    <div className="flex w-full items-center justify-between">
                        <div className="flex items-center justify-between gap-4 md:gap-12 w-full">
                            {/* Logo */}
                            <div className="cursor-pointer flex items-center gap-2" onClick={() => handleDropdownItemClick("https://www.stitchflow.com")}>
                                <Image
                                    alt={logo.alt}
                                    src={logo.src}
                                    width={logo.width}
                                    height={logo.height}
                                    priority
                                    className="h-7"
                                />
                            </div>

                            <DesktopNavigation
                                menuItems={menuItems}
                                activeDropdown={activeDropdown}
                                toggleDropdown={toggleDropdown}
                                ctaButton={ctaButton}
                            />
                        </div>

                        {/* Mobile Menu Toggle */}
                        <button
                            type="button"
                            aria-label="Toggle navigation"
                            className="lg:hidden p-2 top-1 right-3 absolute"
                            onClick={() => setIsOpen(!isOpen)}
                        >
                            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                        </button>
                    </div>
                </div>

                <MobileNavigation
                    isOpen={isOpen}
                    menuItems={menuItems}
                    activeDropdown={activeDropdown}
                    toggleDropdown={toggleDropdown}
                    ctaButton={ctaButton}
                    setIsOpen={setIsOpen}
                    setActiveDropdown={setActiveDropdown}
                />
            </div>
        </div>
    );
};

export default NavbarMain;
