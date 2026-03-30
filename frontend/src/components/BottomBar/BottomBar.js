// import React from 'react';
// import styles from './BottomBar.module.css';
// import { FaRegClock, FaLightbulb, FaCoins, FaForward, FaShieldAlt, FaUserGraduate } from 'react-icons/fa';

// const BottomBar = ({ onDashboardClick }) => {
//   const powerUps = [
//     { icon: <FaRegClock />, name: 'TIME' },
//     { icon: <FaLightbulb />, name: 'HINT' },
//     { icon: <FaForward />, name: 'SKIP' },
//     { icon: <FaShieldAlt />, name: 'SHIELD' },
//   ];

//   return (
//     <div className={styles.bottomBarContainer}>
//       <div className={styles.powerUpSection}>
//         <h4 className={styles.sectionTitle}>POWER UP</h4>
//         <div className={styles.powerUps}>
//           {powerUps.map((pu, index) => (
//             <div key={index} className={styles.powerUpItem}>
//               <div className={styles.iconContainer}>{pu.icon}</div>
//               <span>{pu.name}</span>
//             </div>
//           ))}
//         </div>
//       </div>
//       <div className={styles.dashboardSection}>
//         <h4 className={styles.sectionTitle}>STUDENT DASHBOARD</h4>
//         <button onClick={onDashboardClick} className={styles.dashboardButton}>
//           <FaUserGraduate />
//         </button>
//       </div>
//     </div>
//   );
// };

// export default BottomBar;
import React from 'react';
import styles from './BottomBar.module.css';
import { FaUserGraduate, FaPercentage } from 'react-icons/fa'; // Only used icons

const BottomBar = ({ onDashboardClick }) => {
  const powerUps = [
    { icon: <FaPercentage />, name: '50:50' },
  ];

  return (
    <div className={styles.bottomBarContainer}>
      <div className={styles.powerUpSection}>
        <h4 className={styles.sectionTitle}>POWER UP</h4>
        <div className={styles.powerUps}>
          {powerUps.map((pu, index) => (
            <div key={index} className={styles.powerUpItem}>
              <div className={styles.iconContainer}>{pu.icon}</div>
              <span>{pu.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.dashboardSection}>
        <h4 className={styles.sectionTitle}>STUDENT DASHBOARD</h4>
        <button onClick={onDashboardClick} className={styles.dashboardButton}>
          <FaUserGraduate />
        </button>
      </div>
    </div>
  );
};

export default BottomBar;
