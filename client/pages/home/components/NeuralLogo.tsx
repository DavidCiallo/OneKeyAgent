export default function NeuralLogo({ className = "w-16 h-16" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Layer 1 - input (left) */}
            <circle cx="15" cy="20" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="15" cy="50" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="15" cy="80" r="4" fill="currentColor" opacity="0.85" />
            {/* Layer 2 - hidden */}
            <circle cx="38" cy="15" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="38" cy="35" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="38" cy="55" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="38" cy="75" r="4" fill="currentColor" opacity="0.85" />
            {/* Layer 3 - hidden */}
            <circle cx="62" cy="25" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="62" cy="50" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="62" cy="75" r="4" fill="currentColor" opacity="0.85" />
            {/* Layer 4 - output (right) */}
            <circle cx="85" cy="20" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="85" cy="50" r="4" fill="currentColor" opacity="0.85" />
            <circle cx="85" cy="80" r="4" fill="currentColor" opacity="0.85" />

            {/* Connections L1 -> L2 */}
            <path d="M19 20 L34 15" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 20 L34 35" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 50 L34 35" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 50 L34 55" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 50 L34 75" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 80 L34 55" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M19 80 L34 75" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />

            {/* Connections L2 -> L3 */}
            <path d="M42 15 L58 25" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 15 L58 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 35 L58 25" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 35 L58 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 35 L58 75" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 55 L58 25" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 55 L58 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 55 L58 75" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 75 L58 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M42 75 L58 75" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />

            {/* Connections L3 -> L4 */}
            <path d="M66 25 L81 20" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 25 L81 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 50 L81 20" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 50 L81 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 50 L81 80" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 75 L81 50" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
            <path d="M66 75 L81 80" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />

            {/* Animated pulse nodes */}
            <circle cx="38" cy="35" r="1.5" fill="currentColor" opacity="0.9">
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="62" cy="50" r="1.5" fill="currentColor" opacity="0.9">
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="38" cy="55" r="1.5" fill="currentColor" opacity="0.9">
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="85" cy="50" r="1.5" fill="currentColor" opacity="0.9">
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="3s" repeatCount="indefinite" />
            </circle>
        </svg>
    );
}
