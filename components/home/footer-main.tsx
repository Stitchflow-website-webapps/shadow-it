"use client";
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

const footerConfig = {
    certifications: [
        { label: 'AICPA SOC2', image: '/tools/shadow-it-scan/footer/Certification_Icon_Container2.svg' },
        { label: 'GDPR', image: '/tools/shadow-it-scan/footer/Certification_Icon_Container.svg' },
        { label: 'CCPA', image: '/tools/shadow-it-scan/footer/Certification_Icon_Container3.svg' },
    ],
    backedBy: {
        label: 'Backed by',
        image: '/tools/shadow-it-scan/footer/okta-ventures.svg',
    },
    freeTools: [
        { label: 'Software renewal tracker', url: 'https://www.stitchflow.com/tools/renewal-tracker' },
        { label: 'IT offboarding checklist', url: 'https://www.stitchflow.com/tools/offboard-it' },
        { label: 'Access control matrix', url: 'https://www.stitchflow.com/tools/access-matrix' },
        { label: 'IT ops report card', url: 'https://www.stitchflow.com/tools/opsreportcard' },
    ],
    resources: [
        { label: 'Blog', url: 'https://www.stitchflow.com/blog' },
        { label: 'Case studies', url: 'https://www.stitchflow.com/case-studies' },
        { label: 'ROI calculator', url: 'https://www.stitchflow.com/tools/roi-calculator' },
    ],
    company: [
        { label: 'About us', url: 'https://www.stitchflow.com/about' },
        { label: 'Security', url: 'https://www.stitchflow.com/security' },
    ],
    socialLinks: [
        { platform: 'YouTube', url: 'https://www.youtube.com/@Stitchflow', icon: '/tools/shadow-it-scan/footer/yt.svg' },
        { platform: 'Instagram', url: 'https://www.instagram.com/stitchflowhq', icon: '/tools/shadow-it-scan/footer/ig.svg' },
        { platform: 'X', url: 'https://x.com/stitchflowHQ', icon: '/tools/shadow-it-scan/footer/x.svg' },
        { platform: 'LinkedIn', url: 'https://www.linkedin.com/company/stitchflowhq', icon: '/tools/shadow-it-scan/footer/in.svg' },
    ],
    reviewBadges: [
        { label: 'Capterra', url: 'https://www.capterra.com/p/10013420/Stitchflow/', image: '/tools/shadow-it-scan/footer/badge1.png' },
        { label: 'G2', url: 'https://www.g2.com/products/stitchflow/reviews', image: '/tools/shadow-it-scan/footer/badge2.png' },
    ],
    copyright: 'Copyright © 2025 Stitchflow, Inc.',
    legalLinks: [
        { label: 'Terms of Service', url: 'https://www.stitchflow.com/terms-of-service' },
        { label: 'Privacy Policy', url: 'https://www.stitchflow.com/privacy' },
    ],
    email: 'contact@stitchflow.io',
};

export default function FooterMain() {
    return (
        <footer
            className="relative w-full pt-14 md:pt-24 pb-12 md:pb-28 overflow-hidden"
            style={{ background: 'linear-gradient(to top, #E0D5C8, #F7F5F2)' }}
        >
            <div className="max-w-[1400px] mx-auto px-4 md:px-20 lg:px-8 xl:px-24">
                <div className="grid grid-cols-12 xl:gap-x-14">
                    <div className="col-span-12 lg:col-span-3">
                        <ul className="grid grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 items-start mx-auto lg:mx-0 justify-center gap-x-2 w-fit">
                            {footerConfig.certifications.map((cert, index) => (
                                <li key={index} className="h-20 w-20 xl:w-16 xl:h-16 md:max-w-[100px] md:max-h-[100px]">
                                    <Image
                                        src={cert.image}
                                        alt={cert.label}
                                        width={60}
                                        height={60}
                                        className="h-full w-full object-contain"
                                    />
                                </li>
                            ))}
                        </ul>
                        <div className="mt-10 flex flex-col items-center md:items-start gap-y-4 gap-x-4">
                            <div className="text-[#A78368] text-[12px]">
                                {footerConfig.backedBy.label}
                            </div>
                            <Image
                                height={40}
                                width={100}
                                alt="Okta Ventures"
                                src={footerConfig.backedBy.image}
                                className="w-[120px]"
                            />
                        </div>
                    </div>
                    <div className="ml-7 md:ml-0 mt-12 lg:mt-0 col-span-12 lg:col-span-7 lg:pl-8 grid grid-cols-2 gap-x-6 gap-y-10 md:flex md:gap-x-8 xl:gap-x-14 text-[#805D4E]">
                        <div className="md:w-1/3">
                            <p className="text-[15px] font-semibold text-[#B69A81]">
                                Free Tools
                            </p>
                            <ul className="mt-4 space-y-[10px]">
                                {footerConfig.freeTools.map((link, index) => (
                                    <li key={index}>
                                        <Link
                                            href={link.url}
                                            className="text-[15px] text-[#805D4E] hover:underline"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="mt-0 xl:mt-0 md:w-1/4 pl-4 md:pl-0">
                            <p className="text-[15px] font-semibold text-[#B69A81]">
                                Resources
                            </p>
                            <ul className="mt-4 space-y-[10px]">
                                {footerConfig.resources.map((link, index) => (
                                    <li key={index}>
                                        <Link
                                            href={link.url}
                                            className="inline-flex items-center text-[15px] text-[#805D4E] hover:underline"
                                        >
                                            <span>{link.label}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <p className="text-[15px] font-semibold text-[#B69A81]">Company</p>
                            <ul className="mt-4 space-y-[10px]">
                                {footerConfig.company.map((link, index) => (
                                    <li key={index}>
                                        <Link
                                            href={link.url}
                                            className="text-[15px] text-[#805D4E] hover:underline"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="mt-10 md:mt-20 xl:mt-0 col-span-12 lg:col-span-2 flex flex-col items-center lg:items-start">
                        <ul className="flex w-full items-center justify-center lg:justify-start gap-2">
                            {footerConfig.socialLinks.map((social, index) => (
                                <li key={index}>
                                    <a
                                        href={social.url}
                                        title={social.platform}
                                        target="_blank"
                                        rel="noopener"
                                        className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full hover:opacity-80 transition-opacity"
                                    >
                                        <Image
                                            src={social.icon}
                                            alt={social.platform}
                                            width={30}
                                            height={30}
                                            className="object-contain"
                                        />
                                    </a>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-8 flex flex-col items-center md:items-start md:justify-start gap-3">
                            {footerConfig.reviewBadges.map((badge, index) => (
                                <Link
                                    key={index}
                                    href={badge.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block w-[120px] hover:opacity-80 transition-opacity"
                                >
                                    <Image
                                        src={badge.image}
                                        alt={badge.label}
                                        width={120}
                                        height={56}
                                        className="w-full h-full object-contain"
                                    />
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="mt-12 md:mt-24 xl:mt-32 px-2 md:px-0">
                    <Image
                        src="/tools/shadow-it-scan/footer/footer-wordmark.png"
                        alt="Stitchflow"
                        width={1920}
                        height={1080}
                        className="w-full h-auto object-contain"
                    />
                </div>
                <div className="mt-12 md:mt-24 flex flex-col md:flex-row items-center justify-center md:justify-between flex-wrap w-full gap-4 md:gap-6">
                    <div className="font-normal text-xs leading-6 text-[#A78368]">
                        {footerConfig.copyright}
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-center md:justify-between gap-2 md:gap-6 flex-wrap px-20 sm:px-0 text-[#A78368]">
                        {footerConfig.legalLinks.map((link, index) => (
                            <Link
                                key={index}
                                href={link.url}
                                className="font-normal text-xs leading-6 no-underline hover:underline"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <a
                            href={`mailto:${footerConfig.email}`}
                            className="font-normal text-xs leading-6 no-underline hover:underline"
                        >
                            {footerConfig.email}
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    );
}
