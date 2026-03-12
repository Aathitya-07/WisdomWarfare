import React from 'react';
import styles from './TopBar.module.css';
import { FaGraduationCap, FaMedal, FaStar, FaClock } from 'react-icons/fa';

const TopBar = ({ wave, totalWaves, timer, score, accuracy }) => {
  return (
    <div className={styles.topBarContainer}>
      <div className={styles.waveInfo}>
        <FaGraduationCap className={styles.icon} />
        Wave {wave} / {totalWaves}
      </div>
      <div className={styles.timerInfo}>
        <FaClock className={styles.icon} />
        {timer}
      </div>
      <div className={styles.scoreInfo}>
        <FaMedal className={styles.icon} />
        Score: {score}
      </div>
      <div className={styles.accuracyInfo}>
        <FaStar className={styles.icon} />
        Accuracy: {accuracy}%
      </div>
    </div>
  );
};

export default TopBar;