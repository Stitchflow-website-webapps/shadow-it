"use client";
import { Sparkles, Shield, Zap, RefreshCw, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";
import ButtonNavbar from "./button-navbar";

export function WhyStitchflow({ className }: { className?: string }) {
    return (
        <section className={cn("text-black py-8 md:py-12", className)}>
            <div className="container mx-auto w-full px-4">
                <div className="max-w-5xl mx-auto">
                    {/* Main Heading */}
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.2] md:leading-[1.15]">
                            Unlock SCIM for any app without the enterprise upgrade.
                        </h2>
                        <p className="text-sm md:text-base text-gray-600 max-w-3xl mx-auto leading-[1.8] mb-6">
                            Don't let the "SCIM tax" force you into manual offboarding. Stitchflow delivers resilient, human-in-the-loop browser automation to provision and deprovision users in non-SCIM apps.
                        </p>
                        <p className="text-sm md:text-base text-gray-600 max-w-3xl mx-auto leading-[1.8]">
                            Get enterprise-grade SCIM control on the plans you already have.
                        </p>
                    </div>

                    {/* Feature Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                        {/* Card 1 */}
                        <div className="group relative bg-[#FEFDFB] rounded-2xl p-8 border border-[#E8E3DC] hover:border-[#D4CEC3] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all">
                            <div className="mb-5">
                                <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center mb-5">
                                    <Shield className="w-7 h-7 text-emerald-600" />
                                </div>
                                <h3 className="font-semibold text-lg mb-3 text-gray-900">Zero Orphaned Accounts</h3>
                                <p className="text-sm text-gray-600 leading-[1.75]">
                                    Automate deprovisioning for every app to eliminate access risks instantly.
                                </p>
                            </div>
                        </div>

                        {/* Card 2 */}
                        <div className="group relative bg-[#FEFDFB] rounded-2xl p-8 border border-[#E8E3DC] hover:border-[#D4CEC3] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all">
                            <div className="mb-5">
                                <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl flex items-center justify-center mb-5">
                                    <RefreshCw className="w-7 h-7 text-blue-600" />
                                </div>
                                <h3 className="font-semibold text-lg mb-3 text-gray-900">Trigger from your IdP</h3>
                                <p className="text-sm text-gray-600 leading-[1.75]">
                                    Extend your existing Okta or Entra workflows to control apps that lack native SCIM support.
                                </p>
                            </div>
                        </div>

                        {/* Card 3 */}
                        <div className="group relative bg-[#FEFDFB] rounded-2xl p-8 border border-[#E8E3DC] hover:border-[#D4CEC3] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all">
                            <div className="mb-5">
                                <div className="w-14 h-14 bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl flex items-center justify-center mb-5">
                                    <Zap className="w-7 h-7 text-purple-600" />
                                </div>
                                <h3 className="font-semibold text-lg mb-3 text-gray-900">Guaranteed Resilience</h3>
                                <p className="text-sm text-gray-600 leading-[1.75]">
                                    Our 24/7 human-in-the-loop engineers handle UI changes and CAPTCHAs so automation never breaks.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <div className="flex justify-center">
                        <ButtonNavbar
                            variant="primary"
                            onClick={() => {
                                window.open('https://www.stitchflow.com/schedule-a-demo?utm_source=OffboardIT_App&utm_medium=OffboardIT_CTA', '_blank');
                            }}
                            withArrow
                            arrowAnimation="click"
                            className="px-8 py-2.5 text-base"
                        >
                            Talk to us
                        </ButtonNavbar>
                    </div>
                </div>
            </div>
        </section>
    );
}
