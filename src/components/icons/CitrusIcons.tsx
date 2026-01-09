import React from 'react';

// Citrus Slice Icon - Perfect for branding
export const CitrusSlice = ({ className = "w-6 h-6", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Outer circle */}
    <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" fill="none"/>
    
    {/* Citrus segments */}
    <line x1="12" y1="2" x2="12" y2="22" stroke={color} strokeWidth="1.5"/>
    <line x1="2" y1="12" x2="22" y2="12" stroke={color} strokeWidth="1.5"/>
    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" stroke={color} strokeWidth="1.5"/>
    <line x1="18.5" y1="5.5" x2="5.5" y2="18.5" stroke={color} strokeWidth="1.5"/>
    
    {/* Center circle */}
    <circle cx="12" cy="12" r="2" fill={color} opacity="0.3"/>
    
    {/* Segment details */}
    <circle cx="12" cy="6" r="0.8" fill={color} opacity="0.4"/>
    <circle cx="12" cy="18" r="0.8" fill={color} opacity="0.4"/>
    <circle cx="6" cy="12" r="0.8" fill={color} opacity="0.4"/>
    <circle cx="18" cy="12" r="0.8" fill={color} opacity="0.4"/>
  </svg>
);

// Orange/Lemon Icon - Simplified fruit
export const CitrusFruit = ({ className = "w-6 h-6", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Fruit body */}
    <circle cx="12" cy="13" r="9" fill={color} opacity="0.2" stroke={color} strokeWidth="2"/>
    
    {/* Leaf */}
    <path 
      d="M12 4 Q15 2 17 4 Q15 6 12 4 Z" 
      fill={color} 
      opacity="0.6"
    />
    
    {/* Highlight */}
    <circle cx="9" cy="10" r="2" fill="white" opacity="0.3"/>
  </svg>
);

// Citrus Leaf - For accents
export const CitrusLeaf = ({ className = "w-4 h-4", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      d="M12 2 Q18 6 20 12 Q18 18 12 22 Q6 18 4 12 Q6 6 12 2 Z" 
      fill={color} 
      opacity="0.6"
      stroke={color} 
      strokeWidth="1.5"
    />
    <line x1="12" y1="2" x2="12" y2="22" stroke={color} strokeWidth="1" opacity="0.4"/>
  </svg>
);

// Citrus Half - Cross section
export const CitrusHalf = ({ className = "w-6 h-6", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Half circle */}
    <path 
      d="M 4 12 A 8 8 0 0 1 20 12 L 20 12 Z" 
      fill={color} 
      opacity="0.15"
      stroke={color} 
      strokeWidth="2"
    />
    
    {/* Segments radiating from center */}
    <line x1="12" y1="4" x2="12" y2="12" stroke={color} strokeWidth="1.5"/>
    <line x1="7" y1="6.5" x2="12" y2="12" stroke={color} strokeWidth="1.5"/>
    <line x1="17" y1="6.5" x2="12" y2="12" stroke={color} strokeWidth="1.5"/>
    <line x1="5" y1="10" x2="12" y2="12" stroke={color} strokeWidth="1.5"/>
    <line x1="19" y1="10" x2="12" y2="12" stroke={color} strokeWidth="1.5"/>
    
    {/* Center dot */}
    <circle cx="12" cy="12" r="1.5" fill={color} opacity="0.4"/>
  </svg>
);

// Citrus Wedge - Slice shape
export const CitrusWedge = ({ className = "w-5 h-5", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Wedge shape */}
    <path 
      d="M 12 4 L 20 12 A 8 8 0 0 1 12 20 L 12 4 Z" 
      fill={color} 
      opacity="0.2"
      stroke={color} 
      strokeWidth="2"
      strokeLinejoin="round"
    />
    
    {/* Inner segments */}
    <line x1="12" y1="8" x2="17" y2="12" stroke={color} strokeWidth="1" opacity="0.5"/>
    <line x1="12" y1="12" x2="19" y2="15" stroke={color} strokeWidth="1" opacity="0.5"/>
    <line x1="12" y1="16" x2="15" y2="18" stroke={color} strokeWidth="1" opacity="0.5"/>
  </svg>
);

// Sparkling Citrus - For highlights
export const CitrusSparkle = ({ className = "w-4 h-4", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Main star */}
    <path 
      d="M12 2 L13 11 L22 12 L13 13 L12 22 L11 13 L2 12 L11 11 Z" 
      fill={color} 
      opacity="0.6"
    />
    {/* Small accent stars */}
    <circle cx="6" cy="6" r="1" fill={color} opacity="0.8"/>
    <circle cx="18" cy="18" r="1" fill={color} opacity="0.8"/>
    <circle cx="18" cy="6" r="0.8" fill={color} opacity="0.6"/>
  </svg>
);

// Citrus Peel - Spiral decoration
export const CitrusPeel = ({ className = "w-8 h-8", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      d="M 4 4 Q 8 6 10 10 Q 12 14 16 16 Q 20 18 20 20" 
      stroke={color} 
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
      opacity="0.6"
    />
    <path 
      d="M 5 8 Q 9 9 11 12 Q 13 15 17 17" 
      stroke={color} 
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      opacity="0.4"
    />
  </svg>
);

// Citrus Drops - Juice drops
export const CitrusDrops = ({ className = "w-6 h-6", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      d="M 8 8 Q 8 4 10 4 Q 12 4 12 8 Q 12 12 10 12 Q 8 12 8 8 Z" 
      fill={color} 
      opacity="0.5"
    />
    <path 
      d="M 14 12 Q 14 8 16 8 Q 18 8 18 12 Q 18 16 16 16 Q 14 16 14 12 Z" 
      fill={color} 
      opacity="0.6"
    />
    <circle cx="6" cy="18" r="2" fill={color} opacity="0.4"/>
  </svg>
);

// Citrus Zest - Scattered dots
export const CitrusZest = ({ className = "w-6 h-6", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="6" cy="6" r="1.5" fill={color} opacity="0.7"/>
    <circle cx="12" cy="4" r="1" fill={color} opacity="0.6"/>
    <circle cx="18" cy="7" r="1.2" fill={color} opacity="0.8"/>
    <circle cx="4" cy="12" r="0.8" fill={color} opacity="0.5"/>
    <circle cx="10" cy="10" r="1.3" fill={color} opacity="0.7"/>
    <circle cx="16" cy="12" r="1" fill={color} opacity="0.6"/>
    <circle cx="7" cy="16" r="1.1" fill={color} opacity="0.65"/>
    <circle cx="14" cy="18" r="1.4" fill={color} opacity="0.75"/>
    <circle cx="20" cy="16" r="0.9" fill={color} opacity="0.55"/>
  </svg>
);

// Citrus Burst - Radiating lines
export const CitrusBurst = ({ className = "w-8 h-8", color = "currentColor" }: { className?: string; color?: string }) => (
  <svg 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="12" cy="12" r="3" fill={color} opacity="0.3"/>
    <line x1="12" y1="2" x2="12" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="12" y1="17" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="2" y1="12" x2="7" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="17" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="5" y1="5" x2="8.5" y2="8.5" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="15.5" y1="15.5" x2="19" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="19" y1="5" x2="15.5" y2="8.5" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <line x1="8.5" y1="15.5" x2="5" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
  </svg>
);

export default {
  CitrusSlice,
  CitrusFruit,
  CitrusLeaf,
  CitrusHalf,
  CitrusWedge,
  CitrusSparkle,
  CitrusPeel,
  CitrusDrops,
  CitrusZest,
  CitrusBurst
};

