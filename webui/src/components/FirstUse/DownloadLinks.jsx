import React from 'react';
import Button from '@material-ui/core/Button';
import classnames from 'classnames';
import './firstUse.css';

import WindowsIcon from '../../res/windows.svg';
import MacOsIcon from '../../res/macos.svg';
import LinuxIcon from '../../res/linux.svg';
import RaspberryIcon from '../../res/raspberry.svg';

export const DownloadLinks = ({ twoLinesLayout }) => (
  <div className={classnames('downloadPlatforms', { twoLinesLayout })}>
    <div className="platform">
      <img src={WindowsIcon} />
      <h3>Windows</h3>
      <Button variant="outlined" className="downloadButton" href="https://github.com/geekuillaume/soundsync/releases/download/bleeding-edge/Soundsync_Setup_0.2.1.exe">Download</Button>
    </div>
    <div className="platform">
      <img src={MacOsIcon} />
      <h3>MacOS</h3>
      <Button variant="outlined" className="downloadButton" href="https://github.com/geekuillaume/soundsync/releases/download/bleeding-edge/soundsync-0.2.1.dmg">Download</Button>
    </div>
    <div className="platform">
      <img src={LinuxIcon} />
      <h3>Linux</h3>
      <Button variant="outlined" className="downloadButton" href="https://github.com/geekuillaume/soundsync/releases/download/bleeding-edge/soundsync-amd64-0.2.1.deb">
        <span>Download</span>
        <span className="packageInfo">.deb for Ubuntu/Debian</span>
      </Button>
      <Button variant="outlined" className="downloadButton" href="https://github.com/geekuillaume/soundsync/releases/download/bleeding-edge/soundsync-x64-0.2.1.pacman">
        <span>Download</span>
        <span className="packageInfo">.pacman for Archlinux</span>
      </Button>
    </div>
    <div className="platform">
      <img src={RaspberryIcon} />
      <h3>Linux ARM (Raspberry)</h3>
      <Button variant="outlined" className="downloadButton" href="https://github.com/geekuillaume/soundsync/releases/download/bleeding-edge/soundsync-armv7l-0.2.1.deb">
        <span>Download</span>
        <span className="packageInfo">.deb for Raspbian</span>
      </Button>
    </div>
  </div>
);
