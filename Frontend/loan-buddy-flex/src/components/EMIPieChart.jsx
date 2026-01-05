import { useState } from "react";

export const EMIPieChart = ({ principal, interest }) => {
  const [hoveredSlice, setHoveredSlice] = useState(null);

  if (!principal || !interest) {
    return (
      <div className="w-full h-[300px] flex items-center justify-center">
        <p className="text-gray-500">Loading chart...</p>
      </div>
    );
  }

  const totalAmount = principal + interest;
  const principalPercent = (principal / totalAmount) * 100;
  const interestPercent = (interest / totalAmount) * 100;
  
  // Calculate angles for SVG pie chart
  const principalAngle = (principalPercent / 100) * 360;
  const interestAngle = (interestPercent / 100) * 360;
  
  // SVG path calculations
  const radius = 120;
  const centerX = 150;
  const centerY = 150;
  
  const principalEndAngle = principalAngle;
  const interestEndAngle = principalAngle + interestAngle;
  
  const principalX = centerX + radius * Math.cos((principalEndAngle - 90) * Math.PI / 180);
  const principalY = centerY + radius * Math.sin((principalEndAngle - 90) * Math.PI / 180);
  
  const interestX = centerX + radius * Math.cos((interestEndAngle - 90) * Math.PI / 180);
  const interestY = centerY + radius * Math.sin((interestEndAngle - 90) * Math.PI / 180);
  
  const principalLargeArc = principalAngle > 180 ? 1 : 0;
  const interestLargeArc = interestAngle > 180 ? 1 : 0;

  return (
    <div className="w-full h-[400px] flex flex-col items-center justify-center space-y-6 relative">
      {/* Color Legend */}
      <div className="flex gap-8 text-sm mb-4">
        <div 
          className="flex items-center gap-3 cursor-pointer transition-all duration-200 px-3 py-2 rounded-lg hover:bg-gray-50"
          onMouseEnter={() => setHoveredSlice('principal')}
          onMouseLeave={() => setHoveredSlice(null)}
          style={{ opacity: hoveredSlice === null || hoveredSlice === 'principal' ? 1 : 0.6 }}
        >
          <div className="w-5 h-5 rounded-full shadow-sm" style={{backgroundColor: '#3b82f6'}}></div>
          <span className="font-medium text-gray-700">Principal</span>
        </div>
        <div 
          className="flex items-center gap-3 cursor-pointer transition-all duration-200 px-3 py-2 rounded-lg hover:bg-gray-50"
          onMouseEnter={() => setHoveredSlice('interest')}
          onMouseLeave={() => setHoveredSlice(null)}
          style={{ opacity: hoveredSlice === null || hoveredSlice === 'interest' ? 1 : 0.6 }}
        >
          <div className="w-5 h-5 rounded-full shadow-sm" style={{backgroundColor: '#f59e0b'}}></div>
          <span className="font-medium text-gray-700">Interest</span>
        </div>
      </div>

      {/* SVG Pie Chart */}
      <div className="relative">
        <svg width="300" height="300" viewBox="0 0 300 300" className="drop-shadow-lg">
          {/* Principal slice */}
          <path
            d={`M ${centerX} ${centerY} L ${centerX} ${centerY - radius} A ${radius} ${radius} 0 ${principalLargeArc} 1 ${principalX} ${principalY} Z`}
            fill={hoveredSlice === 'principal' ? "#2563eb" : "#3b82f6"}
            stroke="white"
            strokeWidth="2"
            className="cursor-pointer transition-colors duration-200"
            onMouseEnter={() => setHoveredSlice('principal')}
            onMouseLeave={() => setHoveredSlice(null)}
          />
          
          {/* Interest slice */}
          <path
            d={`M ${centerX} ${centerY} L ${principalX} ${principalY} A ${radius} ${radius} 0 ${interestLargeArc} 1 ${interestX} ${interestY} Z`}
            fill={hoveredSlice === 'interest' ? "#d97706" : "#f59e0b"}
            stroke="white"
            strokeWidth="2"
            className="cursor-pointer transition-colors duration-200"
            onMouseEnter={() => setHoveredSlice('interest')}
            onMouseLeave={() => setHoveredSlice(null)}
          />
          
          {/* Center circle with total */}
          <circle cx={centerX} cy={centerY} r="50" fill="white" stroke="#e5e7eb" strokeWidth="3"/>
          <text x={centerX} y={centerY - 8} textAnchor="middle" className="text-sm font-semibold fill-gray-700">
            Total Amount
          </text>
          <text x={centerX} y={centerY + 12} textAnchor="middle" className="text-lg font-bold fill-gray-900">
            ₹{totalAmount.toLocaleString()}
          </text>
          
          {/* Principal percentage text - only on hover */}
          {hoveredSlice === 'principal' && principalAngle > 30 && (
            <text 
              x={centerX + (radius * 0.6) * Math.cos((principalAngle/2 - 90) * Math.PI / 180)} 
              y={centerY + (radius * 0.6) * Math.sin((principalAngle/2 - 90) * Math.PI / 180)} 
              textAnchor="middle" 
              className="text-xs font-bold fill-white"
            >
              {principalPercent.toFixed(0)}%
            </text>
          )}
          
          {/* Interest percentage text - only on hover */}
          {hoveredSlice === 'interest' && interestAngle > 30 && (
            <text 
              x={centerX + (radius * 0.6) * Math.cos((principalAngle + interestAngle/2 - 90) * Math.PI / 180)} 
              y={centerY + (radius * 0.6) * Math.sin((principalAngle + interestAngle/2 - 90) * Math.PI / 180)} 
              textAnchor="middle" 
              className="text-xs font-bold fill-white"
            >
              {interestPercent.toFixed(0)}%
            </text>
          )}
        </svg>
        
        {/* Hover tooltip */}
        {hoveredSlice && (
          <div className="absolute top-0 left-full ml-4 bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg z-10">
            <div className="text-sm font-semibold">
              {hoveredSlice === 'principal' ? 'Principal Amount' : 'Total Interest'}
            </div>
            <div className="text-xs">
              ₹{hoveredSlice === 'principal' ? 
                principal.toLocaleString() : 
                interest.toLocaleString()
              } ({hoveredSlice === 'principal' ? 
                principalPercent.toFixed(1) : 
                interestPercent.toFixed(1)
              }%)
            </div>
          </div>
        )}
      </div>
      

      

    </div>
  );
};