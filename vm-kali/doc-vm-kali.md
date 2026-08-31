# VM-KALI

## Description

`vm-kali` is a virtual machine running **Kali Linux**, used as the **attack simulation machine** within the PFE testing environment.

Its purpose is to simulate different types of attacks and malicious activities in a controlled and isolated environment.

## Role

The main role of this VM is to act as the **offensive/test machine** of the project.

It is used to:

- Generate attack traffic.
- Simulate malicious activities.
- Test the detection mechanisms of the platform.
- Verify how the other virtual machines react to simulated attacks.
- Validate the overall behavior of the cybersecurity platform.



## Position in the Project

The VM-KALI is not part of the defensive mechanisms themselves. It is used to **generate controlled attack scenarios** in order to test and validate the different components of the PFE.

The general testing flow is:

```text
VM-KALI
   │
   │ Simulated attacks
   ▼
PFE Cyberdefense Platform
   │
   │ Detection / Analysis / Response
   ▼
Test Results
```



## Environment

The VM is intended to be used exclusively within the project's controlled virtualized environment.

All tests performed from this machine should target only the virtual machines and resources belonging to the PFE laboratory

