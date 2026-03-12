import React from 'react';
import styles from './SideMissions.module.css';
import { FaChevronRight, FaQuestionCircle, FaTrophy, FaWaveSquare } from 'react-icons/fa';

const SideMissions = ({ missions }) => {
  const icons = [<FaQuestionCircle/>, <FaTrophy/>, <FaWaveSquare/>]; // Using index 0, 1, 2 for example

  return (
    <div className={`bordered-container ${styles.missionsContainer}`}>
      <div className={styles.titleHeader}>
        <h3 className={styles.title}>SIDE MISSIONS </h3>
        <FaChevronRight />
      </div>
      <ul className={styles.missionList}>
        {missions.map((mission, index) => (
          <li key={index} className={styles.missionItem}>
            <div className={styles.missionIcon}>{icons[index % icons.length]}</div> {/* Cycle through icons */}
            <div className={styles.missionDetails}>
              <p>{mission.text} ({mission.current}/{mission.total})</p>
            </div>
            <FaChevronRight className={styles.missionArrow}/>
          </li>
        ))}
      </ul>
      <div className={styles.lightningRound}>
        <span className={styles.alertIcon}>!</span> LIGHTNING ROUND IN 00:30
      </div>
    </div>
  );
};

export default SideMissions;