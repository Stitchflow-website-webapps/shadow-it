// components/Button.tsx
import React from "react";
import { ArrowRightIcon } from "lucide-react";

type ButtonProps = {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    type?: "button" | "submit" | "reset";
    variant?: "primary" | "secondary" | "outline" | "white";
    className?: string;
    disabled?: boolean;
    withArrow?: boolean;
    arrowAnimation?: "hover" | "click" | "appear-on-hover";
};

const ButtonNavbar: React.FC<ButtonProps> = ({
    children,
    onClick,
    type = "button",
    variant = "primary",
    className = "",
    disabled = false,
    withArrow = false,
    arrowAnimation,
}) => {
    const baseStyles =
        "cursor-pointer px-4 py-2 rounded-xl font-medium flex items-center justify-center whitespace-nowrap transition-all duration-200 ease-in-out transform focus:outline-none";

    const variants: Record<string, string> = {
        primary:
            "shadow-[0px_2px_12px_rgba(84,80,88,0.25),0px_2px_3px_rgba(84,80,88,0.27),inset_0px_-2px_4px_rgba(0,0,0,0.6)] bg-[#363338] bg-gradient-to-b from-[#545058] to-[#363338] hover:to-[#1c1c1c] active:to-[#1f1e1f] text-white group",
        secondary:
            "shadow-[0px_2px_12px_#54505840,0px_2px_3px_#54505845,inset_0px_-2px_4px_#00000099] bg-[#363338] bg-gradient-to-b from-[#545058] to-[#363338] hover:to-[#1c1c1c] active:to-[#1f1e1f] text-white",
        white:
            "border-[1.5px] shadow-sm  border-[#E0D5C8] bg-white text-[#363338]",
        outline:
            "border border-[#54505833] bg-transparent text-gray-700 hover:bg-[#54505810] shadow active:shadow-none group",
    };

    const disabledStyles = disabled ? "opacity-50 cursor-not-allowed" : "";

    // Set default animation to "hover" if withArrow is true but no arrowAnimation is provided
    const effectiveArrowAnimation = arrowAnimation || (withArrow ? "hover" : undefined);

    // Arrow animation classes based on the selected animation type
    const getArrowAnimationClass = () => {
        switch (effectiveArrowAnimation) {
            case "hover":
                return "transition-transform duration-200 group-hover:translate-x-1";
            case "click":
                return "transition-transform duration-200 group-active:translate-x-1.5";
            case "appear-on-hover":
                return "w-0 opacity-0 transition-all duration-200 group-hover:w-4 group-hover:opacity-100 group-hover:ml-2 group-hover:translate-x-1";
            default:
                return "";
        }
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`${baseStyles} ${variants[variant]} ${disabledStyles} ${className}`}
        >
            {children}
            {withArrow && effectiveArrowAnimation && !disabled && (
                <ArrowRightIcon className={`${getArrowAnimationClass()} ${effectiveArrowAnimation !== 'appear-on-hover' ? 'ml-2 h-4 w-4' : 'h-4'}`} />
            )}
        </button>
    );
};

export default ButtonNavbar;
